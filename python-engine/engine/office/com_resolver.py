"""Office COM class resolver — auto-detect Office apps across bitness and vendor.

Uses direct ProgID → CLSID lookup in both 64-bit and 32-bit registry views.
Supports Microsoft Office and WPS Office on any Python bitness.

Connection strategy (in order):
  1. GetObject(Class=ProgID)         — fastest, joins running instance (MS Office)
  2. GetActiveObject(CLSID)          — join by CLSID (bypasses ProgID lookup)
  3. CoCreateInstance(CLSID, ALL)    — create new automation server (works for WPS)
  4. Launch exe + GetActiveObject    — last resort

WPS note: WPS registers an empty automation server in the ROT. GetActiveObject
returns this empty instance (Documents.Count=0). CoCreateInstance also creates
a new empty instance. However, this instance CAN open files via Documents.Open()
even if the user already has them open in WPS — WPS uses shared read locks.
COM edits happen in the background; the user sees changes when the file is
saved and their WPS UI reloads the modified file.
"""

from __future__ import annotations

import os
import subprocess
import threading
import sys
import time
from typing import Any

import atexit
import pythoncom
import pywintypes
import win32com.client
import win32gui
import win32process
import winreg

try:
    import psutil
except ImportError:
    psutil = None  # type: ignore


# ── COM initialization (required when Python is spawned as subprocess) ──

_com_initialized = False
_com_init_lock = threading.Lock()


def _ensure_com() -> None:
    """Initialize COM for the current thread if not already done.

    When Python is spawned as a subprocess by the Rust bridge, COM is not
    automatically initialized. Without this, all COM calls fail with
    'Class not registered' or 'Operation unavailable'.
    """
    global _com_initialized
    if _com_initialized:
        return
    with _com_init_lock:
        if _com_initialized:
            return
        try:
            pythoncom.CoInitialize()
            _com_initialized = True
            sys.stderr.write("[com_resolver] COM initialized (CoInitialize)\n")
            sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[com_resolver] COM init failed: {e}\n")
            sys.stderr.flush()


# ── Known ProgIDs per app type, ordered by priority ──

_KNOWN_PROGIDS: dict[str, list[str]] = {
    "word": ["Word.Application", "KWPS.Application"],
    "excel": ["Excel.Application", "KET.Application"],
    "ppt": ["PowerPoint.Application", "KWPP.Application"],
}


def _lookup_clsid(progid: str, view_flag: int = 0) -> str | None:
    """Look up CLSID for a ProgID in a specific registry view."""
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CLASSES_ROOT,
            f"{progid}\\CLSID",
            0,
            winreg.KEY_READ | view_flag,
        )
        clsid, _ = winreg.QueryValueEx(key, "")
        winreg.CloseKey(key)
        return clsid
    except FileNotFoundError:
        return None


def _lookup_server(clsid: str, view_flag: int = 0) -> str | None:
    """Look up LocalServer32 path for a CLSID in a specific registry view."""
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CLASSES_ROOT,
            f"CLSID\\{clsid}\\LocalServer32",
            0,
            winreg.KEY_READ | view_flag,
        )
        val, _ = winreg.QueryValueEx(key, "")
        winreg.CloseKey(key)
        return val
    except FileNotFoundError:
        return None


def _resolve_progids(progid: str) -> list[dict[str, str]]:
    """Resolve a ProgID across both registry views."""
    results: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    for view_flag, view_name in [(0, "64"), (winreg.KEY_WOW64_32KEY, "32")]:
        clsid = _lookup_clsid(progid, view_flag)
        if not clsid:
            continue
        key = (clsid, view_name)
        if key in seen:
            continue
        seen.add(key)
        server = _lookup_server(clsid, view_flag)
        if server:
            results.append({
                "progid": progid,
                "clsid": clsid,
                "server": server,
                "view": view_name,
            })

    return results


_scan_cache: dict[str, list[dict[str, str]]] | None = None


def scan_available_office_classes() -> dict[str, list[dict[str, str]]]:
    """Scan both registry views for all known Office/WPS COM classes."""
    global _scan_cache
    if _scan_cache is not None:
        sys.stderr.write(f"[detect] Step2 注册表扫描: (使用缓存)\n")
        sys.stderr.flush()
        return _scan_cache

    result: dict[str, list[dict[str, str]]] = {}
    for app_type, progids in _KNOWN_PROGIDS.items():
        entries: list[dict[str, str]] = []
        for progid in progids:
            resolved = _resolve_progids(progid)
            entries.extend(resolved)
        result[app_type] = entries
    # Log results
    sys.stderr.write(f"[detect] Step2 注册表扫描:\n")
    for app_type, entries in result.items():
        if entries:
            progids = [e["progid"] for e in entries]
            sys.stderr.write(f"[detect]   {app_type}: {len(entries)} 个注册 → {progids}\n")
        else:
            sys.stderr.write(f"[detect]   {app_type}: 未注册\n")
    sys.stderr.flush()
    _scan_cache = result
    return result


def _launch_server(server_cmd: str) -> None:
    """Launch a COM server executable from its LocalServer32 value."""
    server_cmd = server_cmd.strip()
    if server_cmd.startswith('"'):
        end = server_cmd.index('"', 1)
        exe = server_cmd[1:end]
        args_str = server_cmd[end + 1:].strip()
    else:
        parts = server_cmd.split(None, 1)
        exe = parts[0]
        args_str = parts[1] if len(parts) > 1 else ""

    if not os.path.exists(exe):
        raise FileNotFoundError(f"COM server executable not found: {exe}")

    subprocess.Popen([exe] + args_str.split(), close_fds=True)


def connect_app(app_type: str, connect_only: bool = False) -> Any:
    """Connect to an Office app using multiple strategies.

    Args:
        app_type: "word", "excel", or "ppt"
        connect_only: If True, only join existing instances (Strategy 1 & 2).
            If False, also try creating a new server (Strategy 3 & 4).

    Returns:
        COM Application object.
    """
    _ensure_com()
    available = scan_available_office_classes()
    entries = available.get(app_type, [])
    if not entries:
        raise RuntimeError(
            f"No COM registrations found for '{app_type}'. "
            f"Is Microsoft Office or WPS Office installed?"
        )

    errors: list[str] = []

    for entry in entries:
        progid = entry["progid"]
        clsid_str = entry["clsid"]
        server = entry["server"]
        clsid = pywintypes.IID(clsid_str)

        # Strategy 1: GetObject(Class=ProgID)
        # WARNING: WPS auto-starts on GetObject(Excel.Application), so skip
        # in connect_only mode to prevent blank windows.
        if not connect_only:
            try:
                app = win32com.client.GetObject(Class=progid)
                return app
            except Exception as e:
                errors.append(f"GetObject({progid}): {e}")

        # Strategy 2: GetActiveObject(CLSID) — safe, only ROT lookup
        try:
            obj = pythoncom.GetActiveObject(clsid)
            disp = obj.QueryInterface(pythoncom.IID_IDispatch)
            app = win32com.client.Dispatch(disp)
            return app
        except Exception as e:
            errors.append(f"GetActiveObject({progid}): {e}")

        # Strategy 3 & 4: skip in connect_only mode
        if connect_only:
            continue

        # Strategy 3: CoCreateInstance — create new server
        try:
            before_pids = _get_wps_pids()
            obj = pythoncom.CoCreateInstance(
                clsid, None, pythoncom.CLSCTX_ALL, pythoncom.IID_IDispatch,
            )
            app = win32com.client.Dispatch(obj)
            _hide_app(app)
            _track_com_pids(before_pids)
            _move_new_wps_windows_offscreen(before_pids)
            return app
        except Exception as e:
            errors.append(f"CoCreateInstance({progid}, ALL): {e}")

        # Strategy 4: Launch exe + retry
        try:
            before_pids = _get_wps_pids()
            _launch_server(server)
            time.sleep(3)
            obj = pythoncom.GetActiveObject(clsid)
            disp = obj.QueryInterface(pythoncom.IID_IDispatch)
            app = win32com.client.Dispatch(disp)
            _hide_app(app)
            _track_com_pids(before_pids)
            _move_new_wps_windows_offscreen(before_pids)
            return app
        except Exception as e:
            errors.append(f"Launch({progid}): {e}")

    raise RuntimeError(
        f"Failed to connect to {app_type} ({len(entries)} registration(s) tried).\n"
        + "\n".join(f"  - {e}" for e in errors)
    )


# ── COM process tracking & cleanup ──

_WPS_EXES = ("wps.exe", "et.exe", "wpp.exe")
_com_pids: set[int] = set()  # PIDs created by our CoCreateInstance / _launch_server


def _get_wps_pids() -> set[int]:
    """Get all currently running WPS process PIDs."""
    pids: set[int] = set()
    if psutil is None:
        return pids
    for proc in psutil.process_iter(['pid', 'name']):
        try:
            if proc.info['name'].lower() in _WPS_EXES:
                pids.add(proc.info['pid'])
        except Exception:
            pass
    return pids


def _track_com_pids(before_pids: set[int]) -> None:
    """Record new WPS PIDs that appeared after CoCreateInstance."""
    after = _get_wps_pids()
    new = after - before_pids
    if new:
        _com_pids.update(new)
        sys.stderr.write(f"[com_resolver] 追踪 COM 进程: {new}\n")
        sys.stderr.flush()


def _move_new_wps_windows_offscreen(before_pids: set[int], timeout: float = 3.0) -> None:
    """Move WPS windows from COM-created processes off-screen.

    Only moves windows belonging to NEW WPS processes (not the user's existing WPS).
    Compares PIDs before/after CoCreateInstance to identify COM-created processes.
    """
    import time as _time
    SWP_NOSIZE = 0x0001
    SWP_NOZORDER = 0x0004
    SWP_NOACTIVATE = 0x0010
    OFF_SCREEN = (-10000, -10000)
    deadline = _time.time() + timeout

    while _time.time() < deadline:
        after_pids = _get_wps_pids()
        new_pids = after_pids - before_pids
        if new_pids:
            moved = 0
            def _cb(hwnd: int, _: Any) -> bool:
                nonlocal moved
                if not win32gui.IsWindowVisible(hwnd):
                    return True
                try:
                    _, pid = win32process.GetWindowThreadProcessId(hwnd)
                    if pid in new_pids:
                        title = win32gui.GetWindowText(hwnd)
                        if title:
                            win32gui.SetWindowPos(
                                hwnd, 0,
                                OFF_SCREEN[0], OFF_SCREEN[1], 0, 0,
                                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                            )
                            sys.stderr.write(f"[com_resolver]   移到屏幕外 hwnd={hwnd} pid={pid}: '{title}'\n")
                            sys.stderr.flush()
                            moved += 1
                except Exception:
                    pass
                return True

            try:
                win32gui.EnumWindows(_cb, None)
            except Exception:
                pass

            if moved == 0:
                sys.stderr.write(f"[com_resolver]   新进程 pid={new_pids} 但无可见窗口\n")
                sys.stderr.flush()
            return
        _time.sleep(0.1)

    sys.stderr.write(f"[com_resolver]   未发现新 WPS 进程\n")
    sys.stderr.flush()


def _cleanup_com_processes() -> None:
    """Kill WPS processes that were created by our COM operations."""
    if not _com_pids or psutil is None:
        return
    killed = 0
    for pid in list(_com_pids):
        try:
            proc = psutil.Process(pid)
            name = proc.name().lower()
            if name in _WPS_EXES:
                # 只杀 /Automation 标志的进程，不杀用户正常启动的
                cmdline = ' '.join(proc.cmdline()).lower()
                if '/automation' in cmdline or proc.memory_info().rss < 10 * 1024 * 1024:
                    proc.kill()
                    killed += 1
                    sys.stderr.write(f"[com_resolver] 已清理 COM 进程: pid={pid} ({name})\n")
                else:
                    sys.stderr.write(f"[com_resolver] 跳过非 COM 进程: pid={pid} ({name})\n")
            _com_pids.discard(pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            _com_pids.discard(pid)
        except Exception as e:
            sys.stderr.write(f"[com_resolver] 清理进程失败 pid={pid}: {e}\n")
    if killed > 0:
        sys.stderr.write(f"[com_resolver] 共清理 {killed} 个 COM 进程\n")
        sys.stderr.flush()


# 注册退出清理
atexit.register(_cleanup_com_processes)


def _hide_app(app: Any) -> None:
    """Hide the COM server window so it doesn't distract the user."""
    sys.stderr.write(f"[com_resolver] _hide_app: 设置 COM 属性\n")
    try:
        app.Visible = False
        sys.stderr.write(f"[com_resolver]   Visible=False OK, readback={app.Visible}\n")
    except Exception as e:
        sys.stderr.write(f"[com_resolver]   Visible=False FAIL: {e}\n")
    try:
        app.WindowState = 2  # Minimized
        sys.stderr.write(f"[com_resolver]   WindowState=2 OK, readback={app.WindowState}\n")
    except Exception as e:
        sys.stderr.write(f"[com_resolver]   WindowState=2 FAIL: {e}\n")
    try:
        app.ScreenUpdating = False
        sys.stderr.write(f"[com_resolver]   ScreenUpdating=False OK\n")
    except Exception as e:
        sys.stderr.write(f"[com_resolver]   ScreenUpdating=False FAIL: {e}\n")
    sys.stderr.flush()


def open_document(app: Any, file_path: str, app_type: str = "word") -> Any:
    """Open a document in a COM app instance.

    Works even if the file is already open in another WPS/Office window
    (WPS uses shared read locks).
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    abs_path = os.path.abspath(file_path)

    _hide_app(app)

    if app_type == "word":
        doc = app.Documents.Open(abs_path)
        try:
            doc.Activate()
        except Exception:
            pass
        return doc
    elif app_type == "excel":
        wb = app.Workbooks.Open(abs_path)
        try:
            wb.Activate()
        except Exception:
            pass
        # Initialize Selection so get_selection() works
        try:
            ws = wb.ActiveSheet
            ws.Range("A1").Select()
        except Exception:
            pass
        return wb
    elif app_type == "ppt":
        pres = app.Presentations.Open(abs_path)
        return pres
    else:
        raise ValueError(f"Unknown app_type: {app_type}")


def _close_all_documents(app: Any, app_type: str, save: bool = True) -> None:
    """Close all open documents in the COM instance."""
    try:
        if app_type == "word":
            while app.Documents.Count > 0:
                app.Documents(1).Close(SaveChanges=save)
        elif app_type == "excel":
            while app.Workbooks.Count > 0:
                app.Workbooks(1).Close(SaveChanges=save)
        elif app_type == "ppt":
            while app.Presentations.Count > 0:
                app.Presentations(1).Close()
    except Exception:
        pass


def _quit_app(app: Any) -> None:
    """Try to quit a COM application gracefully."""
    try:
        app.Quit()
    except Exception:
        pass


# ── WPS UI window detection ──

_WPS_EXT_MAP: dict[str, tuple[str, ...]] = {
    "word": (".docx", ".doc", ".docm", ".wps", ".rtf"),
    "excel": (".xlsx", ".xls", ".xlsm", ".et", ".csv"),
    "ppt": (".pptx", ".ppt", ".pptm", ".dps"),
}


def _clean_window_filename(raw: str) -> str:
    """Strip WPS status markers from a window-title filename."""
    s = raw.strip()
    while s.endswith(" *"):
        s = s[:-2].rstrip()
    if s.endswith(" [只读]") or s.endswith(" [Read-Only]"):
        s = s.rsplit(" [", 1)[0].rstrip()
    return s


def _find_office_ui_windows() -> dict[str, list[dict[str, Any]]]:
    """Enumerate top-level windows to find Office/WPS user document windows.

    Returns: {"word": [{filename, window_title}, ...], ...}
    """
    results: dict[str, list[dict[str, Any]]] = {"word": [], "excel": [], "ppt": []}

    def _callback(hwnd: int, _ctx: Any) -> bool:
        if not win32gui.IsWindowVisible(hwnd):
            return True

        rect = win32gui.GetWindowRect(hwnd)
        if rect[2] - rect[0] <= 0 or rect[3] - rect[1] <= 0:
            return True

        title = win32gui.GetWindowText(hwnd).strip()
        if not title or " - " not in title:
            return True

        name_part = title.rsplit(" - ", 1)[0].strip()
        if not name_part:
            return True

        clean = _clean_window_filename(name_part)
        if not clean:
            return True

        lower = clean.lower()
        for app_type, exts in _WPS_EXT_MAP.items():
            if lower.endswith(exts):
                results[app_type].append({
                    "filename": clean,
                    "window_title": title,
                })
                break

        return True

    win32gui.EnumWindows(_callback, None)

    # Deduplicate by filename
    for app_type in results:
        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for d in results[app_type]:
            fn = d["filename"]
            if fn not in seen:
                seen.add(fn)
                unique.append(d)
        results[app_type] = unique

    # Log results
    total = sum(len(v) for v in results.values())
    sys.stderr.write(f"[detect] Step1 窗口枚举: 共找到 {total} 个文档窗口\n")
    for app_type in ("word", "excel", "ppt"):
        docs = results[app_type]
        if docs:
            for d in docs:
                sys.stderr.write(f"[detect]   {app_type}: {d['filename']}  ({d['window_title']})\n")
        else:
            sys.stderr.write(f"[detect]   {app_type}: (无窗口)\n")
    sys.stderr.flush()

    return results


def _read_recent_files(app: Any, app_type: str) -> list[dict[str, str]]:
    """Read RecentFiles list from a COM app instance.

    Returns: [{"name": ..., "path": ...}, ...]  (up to 20 most recent)
    """
    try:
        files = app.RecentFiles
        result: list[dict[str, str]] = []
        count = min(files.Count, 20)
        sys.stderr.write(f"[detect] Step4 RecentFiles: 共 {files.Count} 条，读取前 {count} 条\n")
        for i in range(1, count + 1):
            try:
                f = files(i)
                name = f.Name
                dir_path = f.Path
                full = os.path.join(dir_path, name) if dir_path else name
                result.append({"name": name, "path": full})
                sys.stderr.write(f"[detect]   RF[{i}]: {name} → {full}  exists={os.path.exists(full)}\n")
            except Exception as e:
                sys.stderr.write(f"[detect]   RF[{i}]: 读取失败: {e}\n")
                continue
        sys.stderr.flush()
        return result
    except Exception as e:
        sys.stderr.write(f"[detect] Step4 RecentFiles 访问失败: {e}\n")
        sys.stderr.flush()
        return []


def _get_open_file_paths_from_rot() -> list[str]:
    """Enumerate Running Object Table for file monikers (currently open documents).

    Uses standard COM ROT enumeration — a core pywin32/pythoncom capability.
    Returns absolute file paths registered as file monikers in the ROT.
    """
    _ensure_com()
    paths: list[str] = []
    try:
        rot = pythoncom.GetRunningObjectTable()
        enum = rot.EnumRunning()
        while True:
            try:
                monikers = enum.Next()
                if not monikers:
                    break
                for mk in monikers:
                    try:
                        dn = mk.GetDisplayName(None, None)
                        if dn and os.path.isfile(dn):
                            paths.append(dn)
                    except Exception:
                        pass
            except pywintypes.com_error:
                break
    except Exception as e:
        sys.stderr.write(f"[detect] Step3 ROT 枚举失败: {e}\n")
    sys.stderr.write(f"[detect] Step3 ROT 路径: 找到 {len(paths)} 个文件 moniker\n")
    for p in paths[:10]:
        sys.stderr.write(f"[detect]   ROT: {p}\n")
    sys.stderr.flush()
    return paths


# ── Path resolution cache ──
# Maps filename → resolved full path. Validated before use.
_path_cache: dict[str, str] = {}


def _resolve_user_doc_path(
    filename: str,
    recent_files: list[dict[str, str]] | None = None,
    rot_paths: list[str] | None = None,
) -> str | None:
    """Match a filename from a window title to a full path.

    Tries in order:
      0. Path cache (with existence validation)
      1. ROT file monikers
      2. COM RecentFiles
      3. WPS rcvr_*.ini recovery records
      4. Windows Recent Items (.lnk shortcuts)
      5. Filesystem search in common directories
    """
    sys.stderr.write(f"[detect] Step5 路径解析: '{filename}'\n")

    # Strategy 0: Check path cache
    if filename in _path_cache:
        cached = _path_cache[filename]
        if os.path.exists(cached):
            sys.stderr.write(f"[detect]   ✓ 缓存命中: {cached}\n")
            sys.stderr.flush()
            return cached
        else:
            sys.stderr.write(f"[detect]   ✗ 缓存失效 (文件已移动/删除): {cached}\n")
            del _path_cache[filename]

    # Strategy 1: ROT file monikers
    if rot_paths:
        for p in rot_paths:
            if os.path.basename(p) == filename:
                sys.stderr.write(f"[detect]   ✓ ROT 精确匹配: {p}\n")
                _path_cache[filename] = p
                sys.stderr.flush()
                return p
        lower_name = filename.lower()
        for p in rot_paths:
            if os.path.basename(p).lower() == lower_name:
                sys.stderr.write(f"[detect]   ✓ ROT 忽略大小写匹配: {p}\n")
                _path_cache[filename] = p
                sys.stderr.flush()
                return p
        sys.stderr.write(f"[detect]   ✗ ROT 无匹配 (共 {len(rot_paths)} 条)\n")
    else:
        sys.stderr.write(f"[detect]   ⊘ ROT 跳过 (无路径)\n")

    # Strategy 2: COM RecentFiles
    if recent_files:
        for rf in recent_files:
            if rf["name"] == filename and os.path.exists(rf["path"]):
                sys.stderr.write(f"[detect]   ✓ RF 精确匹配: {rf['path']}\n")
                _path_cache[filename] = rf["path"]
                sys.stderr.flush()
                return rf["path"]
        lower_name = filename.lower()
        for rf in recent_files:
            if rf["name"].lower() == lower_name and os.path.exists(rf["path"]):
                sys.stderr.write(f"[detect]   ✓ RF 忽略大小写匹配: {rf['path']}\n")
                _path_cache[filename] = rf["path"]
                sys.stderr.flush()
                return rf["path"]
        sys.stderr.write(f"[detect]   ✗ RF 无匹配 (共 {len(recent_files)} 条)\n")
    else:
        sys.stderr.write(f"[detect]   ⊘ RF 跳过 (无数据)\n")

    # Strategy 3: WPS rcvr_*.ini recovery records
    path = _search_wps_rcvr(filename)
    if path:
        _path_cache[filename] = path
        return path

    # Strategy 4: Windows Recent Items (.lnk shortcuts)
    path = _search_windows_recent(filename)
    if path:
        _path_cache[filename] = path
        return path

    # Strategy 5: Recursive FS search in common directories
    sys.stderr.write(f"[detect]   → 启动递归 FS 搜索...\n")
    fs_results = _search_file_recursive(filename)
    if fs_results:
        path = fs_results[0]  # Take first match for single-path interface
        _path_cache[filename] = path
        return path

    sys.stderr.write(f"[detect]   ✗ 最终结果: 路径未解析 (全部策略失败)\n")
    sys.stderr.flush()
    return None


def _resolve_user_doc_path_all(
    filename: str,
    recent_files: list[dict[str, str]] | None = None,
    rot_paths: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Match a filename to ALL found full paths (not just the first).

    Returns a list of dicts: {"path": str, "source": str}
    where source is one of: "cache", "rot", "recent", "wps_rcvr", "windows_recent", "fs_search"

    When only 1 result: the caller gets a clean single match.
    When >1 results: the caller should surface ambiguity for user selection.
    """
    sys.stderr.write(f"[detect] _resolve_user_doc_path_all: '{filename}'\n")
    results: list[dict[str, Any]] = []
    seen_paths: set[str] = set()

    def _add(path: str, source: str) -> None:
        norm = os.path.normcase(os.path.abspath(path))
        if norm not in seen_paths:
            seen_paths.add(norm)
            results.append({"path": path, "source": source})
            sys.stderr.write(f"[detect]   ✓ [{source}] {path}\n")

    # Strategy 0: Path cache (validated)
    if filename in _path_cache:
        cached = _path_cache[filename]
        if os.path.exists(cached):
            _add(cached, "cache")

    # Strategy 1: ROT file monikers
    if rot_paths:
        lower_name = filename.lower()
        for p in rot_paths:
            base = os.path.basename(p)
            if base == filename or base.lower() == lower_name:
                _add(p, "rot")

    # Strategy 2: COM RecentFiles
    if recent_files:
        lower_name = filename.lower()
        for rf in recent_files:
            if rf["name"].lower() == lower_name and os.path.exists(rf["path"]):
                _add(rf["path"], "recent")

    # Strategy 3: WPS rcvr_*.ini
    path = _search_wps_rcvr(filename)
    if path:
        _add(path, "wps_rcvr")

    # Strategy 4: Windows Recent Items
    path = _search_windows_recent(filename)
    if path:
        _add(path, "windows_recent")

    # Strategy 5: Recursive FS search
    fs_results = _search_file_recursive(filename)
    for p in fs_results:
        _add(p, "fs_search")

    sys.stderr.write(f"[detect]   共找到 {len(results)} 个候选路径\n")
    sys.stderr.flush()

    # Update path cache with the single result (if unambiguous)
    if len(results) == 1:
        _path_cache[filename] = results[0]["path"]

    return results
    """Search WPS rcvr_*.ini recovery records for a filename.

    WPS stores recent file paths in XML-like config files:
      %APPDATA%/kingsoft/office6/backup/rcvr_et.ini   (Excel)
      %APPDATA%/kingsoft/office6/backup/rcvr_wps.ini  (Word)
      %APPDATA%/kingsoft/office6/backup/rcvr_wpp.ini  (PPT)
    """
    import glob as _glob
    appdata = os.environ.get("APPDATA", "")
    backup_dir = os.path.join(appdata, "kingsoft", "office6", "backup")
    lower_name = filename.lower()

    for ini_path in _glob.glob(os.path.join(backup_dir, "rcvr_*.ini")):
        try:
            with open(ini_path, encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception:
            continue
        for line in content.splitlines():
            line = line.strip()
            if '<file id="' not in line:
                continue
            start = line.index('<file id="') + len('<file id="')
            end = line.index('"', start)
            path = line[start:end]
            basename = os.path.basename(path)
            if (basename == filename or basename.lower() == lower_name) and os.path.exists(path):
                sys.stderr.write(f"[detect]   ✓ rcvr 匹配: {path} (来源: {os.path.basename(ini_path)})\n")
                sys.stderr.flush()
                return path

    sys.stderr.write(f"[detect]   ✗ rcvr 无匹配\n")
    sys.stderr.flush()
    return None


def _search_windows_recent(filename: str) -> str | None:
    """Search Windows Recent Items (.lnk shortcuts) for a filename.

    Reads .lnk files from %APPDATA%/Microsoft/Windows/Recent/ and checks
    if the shortcut target matches the filename.
    """
    try:
        import win32com.client
    except ImportError:
        sys.stderr.write(f"[detect]   ⊘ Recent 跳过 (win32com 不可用)\n")
        sys.stderr.flush()
        return None

    recent_dir = os.path.join(
        os.environ.get("APPDATA", ""),
        "Microsoft", "Windows", "Recent",
    )
    if not os.path.isdir(recent_dir):
        sys.stderr.write(f"[detect]   ⊘ Recent 跳过 (目录不存在)\n")
        sys.stderr.flush()
        return None

    lower_name = filename.lower()
    shell = win32com.client.Dispatch("WScript.Shell")

    try:
        for lnk_name in os.listdir(recent_dir):
            if not lnk_name.lower().endswith(".lnk"):
                continue
            lnk_base = lnk_name[:-4]
            if filename not in lnk_base and lower_name not in lnk_base.lower():
                continue
            try:
                shortcut = shell.CreateShortCut(os.path.join(recent_dir, lnk_name))
                target = shortcut.Targetpath
                if target and os.path.basename(target).lower() == lower_name and os.path.exists(target):
                    sys.stderr.write(f"[detect]   ✓ Recent 匹配: {target} (来源: {lnk_name})\n")
                    sys.stderr.flush()
                    return target
            except Exception:
                continue
    except Exception as e:
        sys.stderr.write(f"[detect]   ✗ Recent 扫描失败: {e}\n")
        sys.stderr.flush()
        return None

    sys.stderr.write(f"[detect]   ✗ Recent 无匹配\n")
    sys.stderr.flush()
    return None


def _search_file_recursive(
    filename: str,
    max_depth: int = 4,
    max_files: int = 5000,
) -> list[str]:
    """Recursively search for a file in common user directories.

    Searches: Desktop, Documents, Downloads (recursively up to max_depth).
    Returns ALL matches (not just the first), sorted by path.
    """
    home = os.path.expanduser("~")
    candidates = [
        os.path.join(home, "Desktop"),
        os.path.join(home, "Documents"),
        os.path.join(home, "Downloads"),
    ]

    results: list[str] = []
    searched = 0
    lower_name = filename.lower()

    for base_dir in candidates:
        if not os.path.isdir(base_dir):
            continue
        try:
            for root, dirs, files in os.walk(base_dir):
                depth = root[len(base_dir):].count(os.sep)
                if depth >= max_depth:
                    dirs.clear()  # Don't go deeper
                for entry in files:
                    searched += 1
                    if searched > max_files:
                        sys.stderr.write(f"[detect]   FS 递归扫描: 达到上限 {max_files}，停止\n")
                        sys.stderr.flush()
                        return results
                    if entry == filename or entry.lower() == lower_name:
                        full = os.path.join(root, entry)
                        results.append(full)
        except PermissionError:
            continue

    sys.stderr.write(f"[detect]   FS 递归扫描: 找到 {len(results)} 个匹配 (扫描了 {searched} 个文件)\n")
    sys.stderr.flush()
    return results





# ── Cached connections ──

_resolved_apps: dict[str, Any] = {}


def get_app(app_type: str, connect_only: bool = True) -> Any:
    """Get COM app object with caching."""
    if app_type in _resolved_apps:
        try:
            _ = _resolved_apps[app_type].Version
            return _resolved_apps[app_type]
        except Exception:
            _resolved_apps.pop(app_type, None)

    app = connect_app(app_type, connect_only=connect_only)
    _resolved_apps[app_type] = app
    return app


def get_app_with_logic(app_type: str) -> Any:
    """Get COM app with full business logic: connect tracking + window hiding.

    This is the safe entry point for code execution (doc_code_exec).
    Unlike raw get_app(), this ensures:
    1. connect_only=True first (don't spawn new processes unnecessarily)
    2. PID tracking for COM-created processes
    3. New WPS windows moved off-screen (hidden from user)
    """
    sys.stderr.write(f"[com_resolver] get_app_with_logic({app_type!r}) — 开始连接\n")
    sys.stderr.flush()

    try:
        app = get_app(app_type, connect_only=True)
        sys.stderr.write(f"[com_resolver]   ✓ 已连接现有 {app_type} 实例\n")
        sys.stderr.flush()
        return app
    except Exception as e:
        sys.stderr.write(f"[com_resolver]   连接现有实例失败: {e}，尝试启动新实例\n")
        sys.stderr.flush()

    before_pids = _get_wps_pids()
    sys.stderr.write(f"[com_resolver]   启动前 WPS 进程: {before_pids}\n")
    sys.stderr.flush()

    app = get_app(app_type, connect_only=False)

    _track_com_pids(before_pids)
    _move_new_wps_windows_offscreen(before_pids)

    sys.stderr.write(f"[com_resolver]   ✓ 新 {app_type} 实例已启动，窗口已隐藏\n")
    sys.stderr.flush()
    return app


def clear_cache(app_type: str | None = None) -> None:
    """Clear cached connections, registry scan cache, path cache, and COM processes."""
    global _scan_cache
    if app_type:
        _resolved_apps.pop(app_type, None)
    else:
        _resolved_apps.clear()
        _scan_cache = None
        _path_cache.clear()
        _cleanup_com_processes()


# ── Detection ──

def detect_all() -> dict[str, dict[str, Any]]:
    """Detect Office/WPS apps and documents.

    1. Window titles (win32gui.EnumWindows) — filenames
    2. COM registry scan (winreg) — available apps
    3. ROT file monikers — open document paths
    4. COM RecentFiles — fallback path resolution
    5. Path matching — filename → full path
    """
    sys.stderr.write(f"[detect] ═══ office_detect 开始 ═══\n")
    sys.stderr.flush()

    # Step 1: Enumerate UI windows
    ui_windows = _find_office_ui_windows()

    # Step 2: Scan registry for COM classes
    available = scan_available_office_classes()

    result: dict[str, dict[str, Any]] = {}

    for app_type in ("word", "excel", "ppt"):
        sys.stderr.write(f"[detect] ─── 处理 {app_type} ───\n")
        entries = available.get(app_type, [])
        user_docs = ui_windows.get(app_type, [])
        has_reg = bool(entries)

        info: dict[str, Any] = {
            "available": has_reg,
            "registrations": [{"progid": e["progid"], "view": e["view"]} for e in entries],
            "user_documents": user_docs,
        }

        if not has_reg:
            info["error"] = f"No COM registrations found for {app_type}"
            sys.stderr.write(f"[detect]   {app_type}: COM 未注册，跳过路径解析\n")
            sys.stderr.flush()
            result[app_type] = info
            continue

        if not user_docs:
            sys.stderr.write(f"[detect]   {app_type}: COM 已注册但无打开的文档窗口\n")
            sys.stderr.flush()
            result[app_type] = info
            continue

        # Step 3 + 4 + 5: Resolve paths
        # Step 3: ROT file monikers (no COM server needed)
        rot_paths = _get_open_file_paths_from_rot()

        # Step 4: COM RecentFiles (connect_only=True to avoid creating new WPS window)
        recent: list[dict[str, str]] = []
        try:
            app = get_app(app_type, connect_only=True)
            recent = _read_recent_files(app, app_type)
        except Exception as e:
            sys.stderr.write(f"[detect] Step4 COM 连接跳过: {e}\n")
            sys.stderr.flush()

        # Step 5: Match each user document (multi-match aware)
        for doc in user_docs:
            candidates = _resolve_user_doc_path_all(doc["filename"], recent, rot_paths)
            if len(candidates) == 1:
                doc["path"] = candidates[0]["path"]
                doc["path_source"] = candidates[0]["source"]
            elif len(candidates) > 1:
                # Ambiguous: multiple files with the same name found
                doc["path"] = None
                doc["ambiguous"] = True
                doc["candidates"] = candidates
                sys.stderr.write(f"[detect]   ⚠ '{doc['filename']}' 有 {len(candidates)} 个同名文件\n")
            # else: 0 candidates — path stays None (unresolved)

        resolved_count = len([d for d in user_docs if d.get('path')])
        ambiguous_count = len([d for d in user_docs if d.get('ambiguous')])
        sys.stderr.write(f"[detect]   {app_type} 最终结果: "
                         f"{resolved_count} 已解析, {ambiguous_count} 多匹配, "
                         f"{len(user_docs) - resolved_count - ambiguous_count} 未解析\n")
        sys.stderr.flush()

        result[app_type] = info

    sys.stderr.write(f"[detect] ═══ office_detect 完成 ═══\n")
    sys.stderr.flush()
    return result


# ── Sync / auto-open ──

def sync_to_user_document(app_type: str) -> dict[str, Any] | None:
    """Sync COM to the user's currently open WPS document.

    Detects WPS window titles, resolves the full path via COM RecentFiles,
    then opens that document in the COM instance.
    """
    ui_windows = _find_office_ui_windows()
    user_docs = ui_windows.get(app_type, [])

    if not user_docs:
        return None

    clear_cache(app_type)
    app = connect_app(app_type, connect_only=False)
    rot_paths = _get_open_file_paths_from_rot()
    recent = _read_recent_files(app, app_type)

    target_path: str | None = None
    target_filename: str = ""
    ambiguous_candidates: list[dict[str, Any]] = []
    for doc in user_docs:
        candidates = _resolve_user_doc_path_all(doc["filename"], recent, rot_paths)
        if len(candidates) == 1:
            target_path = candidates[0]["path"]
            target_filename = doc["filename"]
            break
        elif len(candidates) > 1:
            ambiguous_candidates = candidates
            target_filename = doc["filename"]

    if target_path:
        pass  # Found unambiguous path
    elif ambiguous_candidates:
        return {
            "success": False,
            "message": (
                f"检测到 WPS 窗口 '{target_filename}'，但有 {len(ambiguous_candidates)} 个同名文件。"
                f"请用 request_user_input 让用户选择。"
            ),
            "detected_windows": user_docs,
            "ambiguous": True,
            "candidates": ambiguous_candidates,
        }
    else:
        return {
            "success": False,
            "message": (
                f"检测到 WPS 窗口 '{user_docs[0]['filename']}'，"
                f"但无法解析完整路径。请手动提供 file_path。"
            ),
            "detected_windows": user_docs,
        }

    _close_all_documents(app, app_type)
    _resolved_apps[app_type] = app
    doc = open_document(app, target_path, app_type)

    info: dict[str, Any] = {
        "success": True,
        "title": target_filename,
        "path": target_path,
    }

    if app_type == "word":
        info["paragraph_count"] = doc.Paragraphs.Count
    elif app_type == "excel":
        info["sheets"] = [
            doc.Worksheets(i + 1).Name for i in range(doc.Worksheets.Count)
        ]
    elif app_type == "ppt":
        info["slide_count"] = doc.Slides.Count

    return info


def auto_open_user_document(app: Any, app_type: str) -> None:
    """Auto-detect the user's WPS window and open that document in COM.

    Uses COM's RecentFiles to resolve the file path from window title filenames.
    Raises RuntimeError if the document can't be found.
    """
    ui_windows = _find_office_ui_windows()
    user_docs = ui_windows.get(app_type, [])

    if not user_docs:
        label = {"word": "Word", "excel": "Excel", "ppt": "PPT"}.get(app_type, app_type)
        raise RuntimeError(
            f"No {label} document window detected. "
            f"Use com_edit(operation='open', file_path='...') with a file path."
        )

    # Resolve path via ROT file monikers + COM RecentFiles (multi-match aware)
    rot_paths = _get_open_file_paths_from_rot()
    recent = _read_recent_files(app, app_type)
    target_path: str | None = None
    ambiguous_candidates: list[dict[str, Any]] = []
    for doc in user_docs:
        candidates = _resolve_user_doc_path_all(doc["filename"], recent, rot_paths)
        if len(candidates) == 1:
            target_path = candidates[0]["path"]
            break
        elif len(candidates) > 1:
            ambiguous_candidates = candidates

    if target_path:
        open_document(app, target_path, app_type)
        return

    if ambiguous_candidates:
        paths = [c["path"] for c in ambiguous_candidates]
        raise RuntimeError(
            f"检测到 {len(paths)} 个同名文件：\n" +
            "\n".join(f"  [{i+1}] {p}" for i, p in enumerate(paths)) +
            f"\n请用 request_user_input 让用户选择文件序号。"
        )

    filenames = [d["filename"] for d in user_docs]
    raise RuntimeError(
        f"检测到 WPS 窗口: {filenames}，但无法解析文件路径。"
        f"请使用 request_user_input 询问用户文件路径，"
        f"或 com_edit(operation='open', file_path='...') 手动打开。"
    )

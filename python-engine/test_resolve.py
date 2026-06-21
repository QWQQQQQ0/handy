"""测试文件路径解析策略 — 自动检测 WPS 窗口中的文件名，逐一验证各策略。"""

import os
import glob
import win32gui


# ── WPS 窗口检测（复用 com_resolver 逻辑）──

_WPS_EXT_MAP = {
    "word": (".docx", ".doc", ".docm", ".wps", ".rtf"),
    "excel": (".xlsx", ".xls", ".xlsm", ".et", ".csv"),
    "ppt": (".pptx", ".ppt", ".pptm", ".dps"),
}


def clean_window_filename(raw: str) -> str:
    s = raw.strip()
    while s.endswith(" *"):
        s = s[:-2].rstrip()
    if s.endswith(" [只读]") or s.endswith(" [Read-Only]"):
        s = s.rsplit(" [", 1)[0].rstrip()
    return s


def find_wps_windows() -> list[dict]:
    """枚举 WPS 窗口，返回 [{filename, app_type, window_title}]。"""
    results = []

    def _callback(hwnd, _):
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
        clean = clean_window_filename(name_part)
        if not clean:
            return True
        lower = clean.lower()
        for app_type, exts in _WPS_EXT_MAP.items():
            if lower.endswith(exts):
                results.append({
                    "filename": clean,
                    "app_type": app_type,
                    "window_title": title,
                })
                break
        return True

    win32gui.EnumWindows(_callback, None)

    seen = set()
    unique = []
    for r in results:
        if r["filename"] not in seen:
            seen.add(r["filename"])
            unique.append(r)
    return unique


# ── 路径解析策略 ──

def strategy_fs_search(filename: str) -> list[dict]:
    """Strategy 3: 文件系统搜索常见目录（仅本地文件）。"""
    home = os.path.expanduser("~")
    dirs = [
        os.path.join(home, "Desktop"),
        os.path.join(home, "Documents"),
        os.path.join(home, "Downloads"),
    ]
    results = []
    lower_name = filename.lower()
    for d in dirs:
        if not os.path.isdir(d):
            continue
        try:
            for entry in os.scandir(d):
                if not entry.is_file():
                    continue
                if entry.name == filename or entry.name.lower() == lower_name:
                    results.append({
                        "path": entry.path,
                        "source": d,
                        "exists": True,
                    })
        except PermissionError:
            continue
    return results


def strategy_wps_rcvr(filename: str) -> tuple[list[dict], list[dict]]:
    """Strategy 4: WPS rcvr_*.ini 恢复记录。

    返回 (matches, all_rcvr_files):
      - matches: 命中目标文件的记录
      - all_rcvr_files: 所有 rcvr_*.ini 文件的统计信息
    """
    appdata = os.environ.get("APPDATA", "")
    backup_dir = os.path.join(appdata, "kingsoft", "office6", "backup")
    results = []
    all_rcvr = []
    lower_name = filename.lower()

    for ini_path in sorted(glob.glob(os.path.join(backup_dir, "rcvr_*.ini"))):
        ini_name = os.path.basename(ini_path)
        try:
            with open(ini_path, encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception:
            all_rcvr.append({"name": ini_name, "count": 0, "error": "读取失败"})
            continue

        # 解析所有 file 条目
        file_entries = []
        for line in content.splitlines():
            line = line.strip()
            if '<file id="' not in line:
                continue
            start = line.index('<file id="') + len('<file id="')
            end = line.index('"', start)
            path = line[start:end]
            file_entries.append(path)

            basename = os.path.basename(path)
            if basename == filename or basename.lower() == lower_name:
                results.append({
                    "path": path,
                    "source": ini_name,
                    "exists": os.path.exists(path),
                })

        all_rcvr.append({"name": ini_name, "count": len(file_entries)})

    return results, all_rcvr


def strategy_windows_recent(filename: str) -> list[dict]:
    """Strategy 5: Windows Recent Items (.lnk)。"""
    import win32com.client
    recent_dir = os.path.join(
        os.environ.get("APPDATA", ""),
        "Microsoft", "Windows", "Recent",
    )
    results = []
    lower_name = filename.lower()
    shell = win32com.client.Dispatch("WScript.Shell")

    for lnk_name in os.listdir(recent_dir):
        if not lnk_name.lower().endswith(".lnk"):
            continue
        lnk_base = lnk_name[:-4]
        if filename not in lnk_base and lower_name not in lnk_base.lower():
            continue
        try:
            shortcut = shell.CreateShortCut(os.path.join(recent_dir, lnk_name))
            target = shortcut.Targetpath
            if target and os.path.basename(target).lower() == lower_name:
                results.append({
                    "path": target,
                    "source": lnk_name,
                    "exists": os.path.exists(target),
                })
        except Exception:
            continue
    return results


# ── 主流程 ──

def main():
    windows = find_wps_windows()
    if not windows:
        print("未检测到 WPS 文档窗口，请先用 WPS 打开一个文件。")
        return

    print(f"检测到 {len(windows)} 个 WPS 文档窗口:\n")
    for w in windows:
        print(f"  [{w['app_type']}] {w['filename']}")
        print(f"           窗口: {w['window_title']}")
    print()

    for w in windows:
        filename = w["filename"]
        print("=" * 70)
        print(f"文件: {filename}  (类型: {w['app_type']})")
        print("=" * 70)

        # Strategy 3: FS 搜索
        print("\n  [Strategy 3] 文件系统搜索 (Desktop/Documents/Downloads):")
        hits3 = strategy_fs_search(filename)
        if hits3:
            for h in hits3:
                print(f"    ✓ {h['path']}")
        else:
            print("    ✗ 未找到")

        # Strategy 4: WPS rcvr
        print("\n  [Strategy 4] WPS rcvr_*.ini 恢复记录:")
        hits4, all_rcvr = strategy_wps_rcvr(filename)
        print(f"    扫描目录: {os.path.join(os.environ.get('APPDATA', ''), 'kingsoft', 'office6', 'backup')}")
        for r in all_rcvr:
            err = f" ({r['error']})" if "error" in r else ""
            print(f"      {r['name']}: {r['count']} 条记录{err}")
        if hits4:
            for h in hits4:
                status = "✓ 存在" if h["exists"] else "✗ 已删除/移动"
                print(f"    → {status}  {h['path']}  (来源: {h['source']})")
        else:
            print(f"    → ✗ 未匹配到 '{filename}'")

        # Strategy 5: Windows Recent
        print("\n  [Strategy 5] Windows Recent Items (.lnk):")
        hits5 = strategy_windows_recent(filename)
        if hits5:
            for h in hits5:
                status = "✓ 存在" if h["exists"] else "✗ 已删除/移动"
                print(f"    {status}  {h['path']}  (来源: {h['source']})")
        else:
            print("    ✗ 未找到")

        # 汇总
        all_hits = hits3 + hits4 + hits5
        resolved = [h for h in all_hits if h.get("exists", True)]
        print()
        if resolved:
            print(f"  → 结论: 可用路径 = {resolved[0]['path']}")
        else:
            print(f"  → 结论: 所有策略失败，需要用户提供 file_path")
            print(f"           com_edit({{app:\"{w['app_type']}\", operation:\"open\", file_path:\"实际路径\"}}) ")

        print()


if __name__ == "__main__":
    main()

"""测试 COM 初始化后各种方法能检测到什么。"""

import pythoncom
import win32com.client
import pywintypes
import winreg
import os
import sys


def log(msg):
    sys.stderr.write(f"{msg}\n")
    sys.stderr.flush()


# ── Step 0: COM 初始化 ──
log("Step 0: COM 初始化...")
try:
    pythoncom.CoInitialize()
    log("  ✓ CoInitialize 成功")
except Exception as e:
    log(f"  ✗ CoInitialize 失败: {e}")
    sys.exit(1)


# ── Step 1: 扫描注册表 ──
log("\nStep 1: 扫描注册表...")
KNOWN_PROGIDS = {
    "word": ["Word.Application", "KWPS.Application"],
    "excel": ["Excel.Application", "KET.Application"],
    "ppt": ["PowerPoint.Application", "KWPP.Application"],
}

for app_type, progids in KNOWN_PROGIDS.items():
    for progid in progids:
        try:
            key = winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, f"{progid}\\CLSID", 0, winreg.KEY_READ)
            clsid, _ = winreg.QueryValueEx(key, "")
            winreg.CloseKey(key)
            log(f"  {progid} → CLSID={clsid}")
        except FileNotFoundError:
            log(f"  {progid} → 未注册")


# ── Step 2: GetActiveObject (ROT 查找) ──
log("\nStep 2: GetActiveObject (ROT 查找)...")
for app_type, progids in KNOWN_PROGIDS.items():
    for progid in progids:
        try:
            key = winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, f"{progid}\\CLSID", 0, winreg.KEY_READ)
            clsid_str, _ = winreg.QueryValueEx(key, "")
            winreg.CloseKey(key)
            clsid = pywintypes.IID(clsid_str)
            obj = pythoncom.GetActiveObject(clsid)
            disp = obj.QueryInterface(pythoncom.IID_IDispatch)
            app = win32com.client.Dispatch(disp)
            log(f"  ✓ GetActiveObject({progid}): Version={app.Version}, Docs={app.Documents.Count if hasattr(app, 'Documents') else 'N/A'}")
            # 尝试读 RecentFiles
            try:
                rf = app.RecentFiles
                log(f"    RecentFiles.Count = {rf.Count}")
                for i in range(1, min(rf.Count + 1, 4)):
                    f = rf(i)
                    log(f"    RF[{i}]: {f.Name} → {f.Path}")
            except Exception as e:
                log(f"    RecentFiles 失败: {e}")
            # 尝试读 ActiveDocument
            try:
                doc = app.ActiveDocument
                log(f"    ActiveDocument: {doc.Name} ({doc.FullName})")
            except Exception as e:
                log(f"    ActiveDocument: 无 ({e})")
        except Exception as e:
            log(f"  ✗ GetActiveObject({progid}): {e}")


# ── Step 3: CoCreateInstance ──
log("\nStep 3: CoCreateInstance (创建新实例)...")
for app_type, progids in KNOWN_PROGIDS.items():
    for progid in progids:
        try:
            key = winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, f"{progid}\\CLSID", 0, winreg.KEY_READ)
            clsid_str, _ = winreg.QueryValueEx(key, "")
            winreg.CloseKey(key)
            clsid = pywintypes.IID(clsid_str)
            obj = pythoncom.CoCreateInstance(clsid, None, pythoncom.CLSCTX_ALL, pythoncom.IID_IDispatch)
            app = win32com.client.Dispatch(obj)
            log(f"  ✓ CoCreateInstance({progid}): Version={app.Version}, Docs={app.Documents.Count if hasattr(app, 'Documents') else 'N/A'}")
            try:
                rf = app.RecentFiles
                log(f"    RecentFiles.Count = {rf.Count}")
                for i in range(1, min(rf.Count + 1, 4)):
                    f = rf(i)
                    log(f"    RF[{i}]: {f.Name} → {f.Path}")
            except Exception as e:
                log(f"    RecentFiles 失败: {e}")
        except Exception as e:
            log(f"  ✗ CoCreateInstance({progid}): {e}")


# ── Step 4: ROT 文件 moniker ──
log("\nStep 4: ROT 文件 moniker...")
try:
    rot = pythoncom.GetRunningObjectTable()
    enum = rot.EnumRunning()
    count = 0
    while True:
        try:
            monikers = enum.Next()
            if not monikers:
                break
            for mk in monikers:
                try:
                    dn = mk.GetDisplayName(None, None)
                    if dn and os.path.isfile(dn):
                        log(f"  ✓ {dn}")
                        count += 1
                except Exception:
                    pass
        except pywintypes.com_error:
            break
    log(f"  共 {count} 个文件 moniker")
except Exception as e:
    log(f"  ✗ ROT 枚举失败: {e}")


# ── Step 5: 窗口标题检测 ──
log("\nStep 5: 窗口标题检测...")
import win32gui
found_windows = []

def _callback(hwnd, _):
    if not win32gui.IsWindowVisible(hwnd):
        return True
    title = win32gui.GetWindowText(hwnd).strip()
    if not title or " - " not in title:
        return True
    name_part = title.rsplit(" - ", 1)[0].strip()
    if name_part:
        for ext in (".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".xlsm", ".csv"):
            if name_part.lower().endswith(ext):
                found_windows.append((name_part, title))
                break
    return True

win32gui.EnumWindows(_callback, None)
for name, title in found_windows:
    log(f"  窗口: {name}")
    log(f"    标题: {title}")

log("\n完成。")

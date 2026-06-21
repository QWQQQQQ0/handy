"""COM 自动化检测能力测试 — 验证初始化后各方法能拿到什么数据。

使用方法:
  python test_com.py           # 全部测试
  python test_com.py word      # 只测 Word
  python test_com.py excel     # 只测 Excel
  python test_com.py ppt       # 只测 PPT
"""

import pythoncom
import win32com.client
import pywintypes
import winreg
import os
import sys
import win32gui


TARGET_APP = sys.argv[1] if len(sys.argv) > 1 else None  # word/excel/ppt/None(全部)


# ═══════════════════════════════════════════════════════════
# Step 0: COM 初始化
# ═══════════════════════════════════════════════════════════

print("=" * 60)
print("Step 0: COM 初始化")
print("=" * 60)
try:
    pythoncom.CoInitialize()
    print("  ✓ CoInitialize 成功\n")
except Exception as e:
    print(f"  ✗ CoInitialize 失败: {e}")
    sys.exit(1)


# ═══════════════════════════════════════════════════════════
# Step 1: 注册表扫描
# ═══════════════════════════════════════════════════════════

KNOWN_PROGIDS = {
    "word": ["Word.Application", "KWPS.Application"],
    "excel": ["Excel.Application", "KET.Application"],
    "ppt": ["PowerPoint.Application", "KWPP.Application"],
}

print("=" * 60)
print("Step 1: 注册表扫描 (winreg)")
print("=" * 60)
for app_type, progids in KNOWN_PROGIDS.items():
    if TARGET_APP and app_type != TARGET_APP:
        continue
    for progid in progids:
        for view_flag, view_name in [(0, "64-bit"), (winreg.KEY_WOW64_32KEY, "32-bit")]:
            try:
                key = winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, f"{progid}\\CLSID", 0, winreg.KEY_READ | view_flag)
                clsid, _ = winreg.QueryValueEx(key, "")
                winreg.CloseKey(key)
                print(f"  ✓ {progid:25s} → {clsid}  ({view_name})")
            except FileNotFoundError:
                pass
print()


# ═══════════════════════════════════════════════════════════
# Step 2: GetActiveObject (ROT 查找 — 连接已有实例)
# ═══════════════════════════════════════════════════════════

print("=" * 60)
print("Step 2: GetActiveObject (ROT 查找已有实例)")
print("=" * 60)
for app_type, progids in KNOWN_PROGIDS.items():
    if TARGET_APP and app_type != TARGET_APP:
        continue
    for progid in progids:
        try:
            key = winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, f"{progid}\\CLSID", 0, winreg.KEY_READ)
            clsid_str, _ = winreg.QueryValueEx(key, "")
            winreg.CloseKey(key)
            clsid = pywintypes.IID(clsid_str)
            obj = pythoncom.GetActiveObject(clsid)
            disp = obj.QueryInterface(pythoncom.IID_IDispatch)
            app = win32com.client.Dispatch(disp)

            print(f"\n  ✓ GetActiveObject({progid})")
            print(f"    Version  = {app.Version}")
            print(f"    Visible  = {getattr(app, 'Visible', 'N/A')}")
            print(f"    Caption  = {getattr(app, 'Caption', 'N/A')}")

            # Documents / Workbooks / Presentations
            try:
                if app_type == "word":
                    count = app.Documents.Count
                    print(f"    Documents.Count = {count}")
                    for i in range(1, count + 1):
                        doc = app.Documents(i)
                        print(f"    Doc[{i}]: {doc.Name} → {doc.FullName}")
                    if count > 0:
                        active = app.ActiveDocument
                        print(f"    ActiveDocument: {active.Name} → {active.FullName}")
                elif app_type == "excel":
                    count = app.Workbooks.Count
                    print(f"    Workbooks.Count = {count}")
                    for i in range(1, count + 1):
                        wb = app.Workbooks(i)
                        print(f"    WB[{i}]: {wb.Name} → {wb.FullName}")
                    if count > 0:
                        active = app.ActiveWorkbook
                        print(f"    ActiveWorkbook: {active.Name} → {active.FullName}")
                        ws = active.ActiveSheet
                        print(f"    ActiveSheet: {ws.Name}")
                        used = ws.UsedRange
                        print(f"    UsedRange: {used.Address} ({used.Rows.Count}×{used.Columns.Count})")
                elif app_type == "ppt":
                    count = app.Presentations.Count
                    print(f"    Presentations.Count = {count}")
                    for i in range(1, count + 1):
                        pres = app.Presentations(i)
                        print(f"    Pres[{i}]: {pres.Name} → {pres.FullName}")
            except Exception as e:
                print(f"    文档读取失败: {e}")

            # RecentFiles
            try:
                rf = app.RecentFiles
                print(f"    RecentFiles.Count = {rf.Count}")
                for i in range(1, min(rf.Count + 1, 6)):
                    f = rf(i)
                    print(f"    RF[{i}]: {f.Name} → {f.Path}")
            except Exception as e:
                print(f"    RecentFiles: 失败 ({e})")

        except Exception as e:
            print(f"\n  ✗ GetActiveObject({progid}): {e}")
print()


# ═══════════════════════════════════════════════════════════
# Step 3: CoCreateInstance (创建新 COM 服务器)
# ═══════════════════════════════════════════════════════════

print("=" * 60)
print("Step 3: CoCreateInstance (创建新实例)")
print("=" * 60)
for app_type, progids in KNOWN_PROGIDS.items():
    if TARGET_APP and app_type != TARGET_APP:
        continue
    for progid in progids:
        try:
            key = winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, f"{progid}\\CLSID", 0, winreg.KEY_READ)
            clsid_str, _ = winreg.QueryValueEx(key, "")
            winreg.CloseKey(key)
            clsid = pywintypes.IID(clsid_str)
            obj = pythoncom.CoCreateInstance(clsid, None, pythoncom.CLSCTX_ALL, pythoncom.IID_IDispatch)
            app = win32com.client.Dispatch(obj)
            print(f"\n  ✓ CoCreateInstance({progid})")
            print(f"    Version = {app.Version}")
            print(f"    Visible = {getattr(app, 'Visible', 'N/A')}")
            try:
                rf = app.RecentFiles
                print(f"    RecentFiles.Count = {rf.Count}")
                for i in range(1, min(rf.Count + 1, 4)):
                    f = rf(i)
                    print(f"    RF[{i}]: {f.Name} → {f.Path}")
            except Exception as e:
                print(f"    RecentFiles: 失败 ({e})")
            try:
                app.Quit()
            except Exception:
                pass
        except Exception as e:
            print(f"\n  ✗ CoCreateInstance({progid}): {e}")
print()


# ═══════════════════════════════════════════════════════════
# Step 4: GetObject(Class=ProgID)
# ═══════════════════════════════════════════════════════════

print("=" * 60)
print("Step 4: GetObject(Class=ProgID)")
print("=" * 60)
for app_type, progids in KNOWN_PROGIDS.items():
    if TARGET_APP and app_type != TARGET_APP:
        continue
    for progid in progids:
        try:
            app = win32com.client.GetObject(Class=progid)
            print(f"  ✓ GetObject(Class={progid}): Version={app.Version}")
        except Exception as e:
            print(f"  ✗ GetObject(Class={progid}): {e}")
print()


# ═══════════════════════════════════════════════════════════
# Step 5: ROT 文件 moniker
# ═══════════════════════════════════════════════════════════

print("=" * 60)
print("Step 5: ROT 文件 moniker (Running Object Table)")
print("=" * 60)
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
                    if dn:
                        is_file = os.path.isfile(dn)
                        print(f"  {'✓' if is_file else '○'} {dn}" + (" (文件存在)" if is_file else ""))
                        count += 1
                except Exception:
                    pass
        except pywintypes.com_error:
            break
    if count == 0:
        print("  (空)")
    else:
        print(f"  共 {count} 条 moniker")
except Exception as e:
    print(f"  ✗ ROT 枚举失败: {e}")
print()


# ═══════════════════════════════════════════════════════════
# Step 6: 窗口标题检测
# ═══════════════════════════════════════════════════════════

print("=" * 60)
print("Step 6: 窗口标题检测 (win32gui.EnumWindows)")
print("=" * 60)

WPS_EXT = {
    "word": (".docx", ".doc", ".docm", ".wps", ".rtf"),
    "excel": (".xlsx", ".xls", ".xlsm", ".et", ".csv"),
    "ppt": (".pptx", ".ppt", ".pptm", ".dps"),
}
found_windows = []


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
    clean = name_part
    while clean.endswith(" *"):
        clean = clean[:-2].rstrip()
    if clean.endswith(" [只读]") or clean.endswith(" [Read-Only]"):
        clean = clean.rsplit(" [", 1)[0].rstrip()
    lower = clean.lower()
    for app_type, exts in WPS_EXT.items():
        if lower.endswith(exts):
            found_windows.append({"filename": clean, "app_type": app_type, "title": title})
            break
    return True


win32gui.EnumWindows(_callback, None)
if found_windows:
    seen = set()
    for w in found_windows:
        if TARGET_APP and w["app_type"] != TARGET_APP:
            continue
        if w["filename"] not in seen:
            seen.add(w["filename"])
            print(f"  [{w['app_type']}] {w['filename']}")
            print(f"    窗口标题: {w['title']}")
else:
    print("  (无 Office/WPS 文档窗口)")
print()


# ═══════════════════════════════════════════════════════════
# Step 7: Windows Recent Items (.lnk)
# ═══════════════════════════════════════════════════════════

print("=" * 60)
print("Step 7: Windows Recent Items (.lnk 快捷方式)")
print("=" * 60)
recent_dir = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Recent")
if os.path.isdir(recent_dir):
    office_exts = {".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".xlsm", ".csv", ".docm", ".pptm"}
    shell = win32com.client.Dispatch("WScript.Shell")
    recent_files = []
    for lnk_name in os.listdir(recent_dir):
        if not lnk_name.lower().endswith(".lnk"):
            continue
        lnk_base = lnk_name[:-4].lower()
        if not any(ext in lnk_base for ext in office_exts):
            continue
        try:
            shortcut = shell.CreateShortCut(os.path.join(recent_dir, lnk_name))
            target = shortcut.Targetpath
            if target and os.path.splitext(target)[1].lower() in office_exts:
                exists = os.path.exists(target)
                recent_files.append({"lnk": lnk_name, "target": target, "exists": exists})
        except Exception:
            continue
    for rf in recent_files[-15:]:
        status = "✓" if rf["exists"] else "✗"
        print(f"  {status} {rf['lnk']}")
        print(f"    → {rf['target']}")
    print(f"  共 {len(recent_files)} 条 Office 快捷方式")
else:
    print("  (Recent 目录不存在)")


# ═══════════════════════════════════════════════════════════
# Step 8: ~$ 临时文件 (正在编辑的文档)
# ═══════════════════════════════════════════════════════════

print()
print("=" * 60)
print("Step 8: ~$ 临时文件 (WPS/Office 正在编辑)")
print("=" * 60)
home = os.path.expanduser("~")
search_dirs = [
    os.path.join(home, "Desktop"),
    os.path.join(home, "Documents"),
    os.path.join(home, "Downloads"),
]
found_tmp = 0
for d in search_dirs:
    if not os.path.isdir(d):
        continue
    try:
        for f in os.listdir(d):
            if f.startswith("~$") and not f.startswith("~$WRL"):
                full = os.path.join(d, f)
                if os.path.isfile(full):
                    import datetime
                    mtime = os.path.getmtime(full)
                    t = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
                    original = f[2:]
                    print(f"  {full}")
                    print(f"    原始文件名: {original}")
                    print(f"    修改时间: {t}")
                    found_tmp += 1
    except (PermissionError, OSError):
        pass
if found_tmp == 0:
    print("  (无 ~$ 临时文件)")


print()
print("=" * 60)
print("完成。")
print("=" * 60)

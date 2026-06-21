"""Investigate what info WPS exposes for a running document window.

Usage: python scripts/wps_investigate.py
"""
from __future__ import annotations

import os
import sys
import pythoncom
import pywintypes
import win32com.client
import win32gui
import win32process
import win32con
import winreg


HWND = 67380  # The WPS Excel window from user's data
KNOWN_EXT = ('.xlsx', '.xls', '.xlsm', '.docx', '.doc', '.pptx', '.ppt', '.et', '.wps', '.dps', '.csv')

print("=" * 60)
print("1. Window Properties (win32gui)")
print("=" * 60)

title = win32gui.GetWindowText(HWND)
cls = win32gui.GetClassName(HWND)
rect = win32gui.GetWindowRect(HWND)
_, pid = win32process.GetWindowThreadProcessId(HWND)
print(f"  Title: {title}")
print(f"  Class: {cls}")
print(f"  Rect: {rect}")
print(f"  PID: {pid}")
print(f"  Visible: {win32gui.IsWindowVisible(HWND)}")

# Window long properties
print(f"  GWL_STYLE: 0x{win32gui.GetWindowLong(HWND, win32con.GWL_STYLE):08X}")
print(f"  GWL_EXSTYLE: 0x{win32gui.GetWindowLong(HWND, win32con.GWL_EXSTYLE):08X}")
print(f"  GWL_ID: {win32gui.GetWindowLong(HWND, win32con.GWL_ID)}")

# Enum child windows
print(f"\n  Child windows:")
def enum_child(h, _):
    t = win32gui.GetWindowText(h)
    c = win32gui.GetClassName(h)
    r = win32gui.GetWindowRect(h)
    if t.strip():
        print(f"    [{c}] \"{t}\" rect={r}")
    return True
win32gui.EnumChildWindows(HWND, enum_child, None)


print()
print("=" * 60)
print("2. Running Object Table (ROT) — ALL entries")
print("=" * 60)

rot = pythoncom.GetRunningObjectTable()
enum = rot.EnumRunning()
rot_entries = []
while True:
    try:
        monikers = enum.Next()
        if not monikers:
            break
        for mk in monikers:
            try:
                dn = mk.GetDisplayName(None, None)
                rot_entries.append(dn)
            except Exception:
                rot_entries.append("<no display name>")
    except pywintypes.com_error:
        break

print(f"  Total ROT entries: {len(rot_entries)}")
for i, dn in enumerate(rot_entries):
    is_file = os.path.isfile(dn) if dn and not dn.startswith("<") else False
    marker = " <-- FILE" if is_file else ""
    is_office = any(dn.lower().endswith(ext) for ext in KNOWN_EXT) if is_file else False
    marker = " <-- OFFICE FILE" if is_office else marker
    if i < 30 or is_office or ("excel" in dn.lower() or "wps" in dn.lower() or "et" in dn.lower() or "预警" in dn):
        print(f"  [{i}] {dn}{marker}")
if len(rot_entries) > 30:
    print(f"  ... ({len(rot_entries) - 30} more entries omitted)")


print()
print("=" * 60)
print("3. Try GetObject with different arguments")
print("=" * 60)

# Try connecting via ProgID with empty first arg
progids = ["Excel.Application", "KET.Application", "ET.Application"]
for pid_str in progids:
    try:
        app = win32com.client.GetObject("", pid_str)
        print(f"  GetObject('', '{pid_str}'): SUCCESS, version={app.Version}")
        try:
            print(f"    Workbooks.Count={app.Workbooks.Count}")
            for i in range(1, app.Workbooks.Count + 1):
                wb = app.Workbooks(i)
                print(f"    WB[{i}]: {wb.Name} -> {wb.FullName}")
        except Exception as e:
            print(f"    Workbooks error: {e}")
    except Exception as e:
        print(f"  GetObject('', '{pid_str}'): FAIL - {e}")

    try:
        app = win32com.client.GetObject(Class=pid_str)
        print(f"  GetObject(Class='{pid_str}'): SUCCESS, version={app.Version}")
        try:
            print(f"    Workbooks.Count={app.Workbooks.Count}")
            for i in range(1, app.Workbooks.Count + 1):
                wb = app.Workbooks(i)
                print(f"    WB[{i}]: {wb.Name} -> {wb.FullName}")
        except Exception as e:
            print(f"    Workbooks error: {e}")
    except Exception as e:
        print(f"  GetObject(Class='{pid_str}'): FAIL - {e}")


print()
print("=" * 60)
print("4. Try GetActiveObject by CLSID")
print("=" * 60)

# Known Excel CLSIDs
clsid_map = {
    "Excel.Application (MS)": "{00024500-0000-0000-C000-000000000046}",
    "KET.Application (WPS)": "{00024500-0000-0000-C000-000000000046}",  # WPS reuses MS CLSID
}

# Find WPS-specific CLSID from registry
for view_flag, view_name in [(0, "64"), (winreg.KEY_WOW64_32KEY, "32")]:
    for progid in ["KET.Application", "Excel.Application", "ET.Application"]:
        try:
            key = winreg.OpenKey(
                winreg.HKEY_CLASSES_ROOT,
                f"{progid}\\CLSID",
                0,
                winreg.KEY_READ | view_flag,
            )
            clsid_str, _ = winreg.QueryValueEx(key, "")
            winreg.CloseKey(key)
            print(f"  Registry {view_name}-bit: {progid} -> CLSID {clsid_str}")
            try:
                clsid = pywintypes.IID(clsid_str)
                obj = pythoncom.GetActiveObject(clsid)
                disp = obj.QueryInterface(pythoncom.IID_IDispatch)
                app = win32com.client.Dispatch(disp)
                print(f"    GetActiveObject: SUCCESS, version={app.Version}")
                try:
                    print(f"    Workbooks.Count={app.Workbooks.Count}")
                except Exception as e:
                    print(f"    Workbooks error: {e}")
            except Exception as e:
                print(f"    GetActiveObject: FAIL - {e}")
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"    Registry lookup error: {e}")


print()
print("=" * 60)
print("5. WPS process command line")
print("=" * 60)

import subprocess
result = subprocess.run(
    ['wmic', 'process', 'where', f'ProcessId={pid}', 'get', 'CommandLine', '/format:list'],
    capture_output=True, text=True, timeout=10
)
print(f"  PID {pid} command line: {result.stdout.strip()}")


print()
print("=" * 60)
print("6. WPS COM RecentFiles (via CoCreateInstance)")
print("=" * 60)

# Create a fresh COM server and check RecentFiles
for progid in ["Excel.Application", "KET.Application"]:
    try:
        # Find CLSID
        key = winreg.OpenKey(
            winreg.HKEY_CLASSES_ROOT,
            f"{progid}\\CLSID",
            0,
            winreg.KEY_READ,
        )
        clsid_str, _ = winreg.QueryValueEx(key, "")
        winreg.CloseKey(key)

        clsid = pywintypes.IID(clsid_str)
        obj = pythoncom.CoCreateInstance(
            clsid, None, pythoncom.CLSCTX_ALL, pythoncom.IID_IDispatch,
        )
        app = win32com.client.Dispatch(obj)
        print(f"  CoCreateInstance({progid}): created, version={app.Version}")

        # Check RecentFiles
        try:
            rf = app.RecentFiles
            print(f"    RecentFiles.Count={rf.Count}")
            for i in range(1, min(rf.Count, 10) + 1):
                try:
                    f = rf(i)
                    print(f"    RF[{i}]: name={f.Name}, path={f.Path}")
                except Exception as e:
                    print(f"    RF[{i}]: error: {e}")
        except Exception as e:
            print(f"    RecentFiles error: {e}")

        # Check Workbooks (any documents already open?)
        try:
            print(f"    Workbooks.Count={app.Workbooks.Count}")
        except Exception as e:
            print(f"    Workbooks error: {e}")

        try:
            app.Quit()
        except Exception:
            pass
    except Exception as e:
        print(f"  {progid}: FAIL - {e}")


print()
print("=" * 60)
print("7. WPS registry — RecentFiles / FileMRU")
print("=" * 60)

# Check WPS registry for recent files
wps_reg_paths = [
    r"Software\Kingsoft\Office\6.0\Common\RecentFiles",
    r"Software\Kingsoft\Office\Common\RecentFiles",
    r"Software\Kingsoft\WPS\Common\RecentFiles",
    r"Software\Kingsoft\Office\6.0\et\Recent Files",
    r"Software\Kingsoft\Office\6.0\wps\Recent Files",
    r"Software\Kingsoft\Office\6.0\wpp\Recent Files",
]

for reg_path in wps_reg_paths:
    for view_flag, view_name in [(0, "64bit"), (winreg.KEY_WOW64_32KEY, "32bit")]:
        try:
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                reg_path,
                0,
                winreg.KEY_READ | view_flag,
            )
            print(f"  HKCU\\{reg_path} ({view_name}):")
            info = winreg.QueryInfoKey(key)
            print(f"    SubKeys={info[0]}, Values={info[1]}")
            for i in range(min(info[1], 20)):
                name, value, _ = winreg.EnumValue(key, i)
                print(f"    [{i}] {name} = {value}")
            winreg.CloseKey(key)
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"  Error: {e}")


print()
print("=" * 60)
print("8. Try accessing WPS window via IAccessible / UI Automation")
print("=" * 60)

# Check if WPS window exposes any accessible info with the file path
try:
    import win32com.client as w32c
    acc = w32c.Dispatch("oleacc.IAccessible")
    print("  IAccessible available")
except Exception as e:
    print(f"  IAccessible not available: {e}")


print()
print("=" * 60)
print("9. Check file monikers with specific WPS keywords")
print("=" * 60)

search_terms = ["预警", "xlsx", "xls", "et"]
for term in search_terms:
    for dn in rot_entries:
        if term.lower() in dn.lower():
            print(f"  Found: {dn}")
            break
    else:
        print(f"  No ROT entry contains '{term}'")

print()
print("Done.")

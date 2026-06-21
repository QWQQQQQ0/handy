"""Deep investigation of WPS COM objects and window properties."""
from __future__ import annotations

import os
import sys
import pythoncom
import pywintypes
import win32com.client
import win32gui
import win32process
import win32con
import win32api
import winreg
import ctypes
from ctypes import wintypes

HWND = 67380
# Find XLMAIN child window
XLMAIN_HWND = None
EXCEL7_HWNDS = []

def enum_child(h, _):
    global XLMAIN_HWND, EXCEL7_HWNDS
    cls = win32gui.GetClassName(h)
    if cls == "XLMAIN":
        XLMAIN_HWND = h
    elif cls == "EXCEL7":
        EXCEL7_HWNDS.append(h)
    return True

win32gui.EnumChildWindows(HWND, enum_child, None)
print(f"XLMAIN hwnd: {XLMAIN_HWND}")
print(f"EXCEL7 hwnds: {EXCEL7_HWNDS}")

# ==========================================
print("\n" + "=" * 60)
print("1. Window Properties (GetProp / EnumProps)")
print("=" * 60)

for label, hwnd in [("OpusApp", HWND), ("XLMAIN", XLMAIN_HWND)] + [(f"EXCEL7[{i}]", h) for i, h in enumerate(EXCEL7_HWNDS)]:
    if not hwnd:
        continue
    print(f"\n  [{label}] hwnd={hwnd}:")
    # Try to enumerate props
    props = []
    try:
        def prop_callback(h, prop_name, _):
            try:
                val = win32gui.GetProp(h, prop_name)
                # Try to read as string or handle
                if isinstance(val, int) and val > 0xFFFF:
                    props.append((prop_name, f"0x{val:08X} (maybe HANDLE or ATOM)"))
                else:
                    props.append((prop_name, str(val)))
            except Exception as e:
                props.append((prop_name, f"<error: {e}>"))
            return True
        win32gui.EnumProps(hwnd, prop_callback, None)
    except Exception as e:
        print(f"    EnumProps failed: {e}")
    for name, val in props:
        print(f"    Prop '{name}' = {val}")

# ==========================================
print("\n" + "=" * 60)
print("2. ROT entries — probe each via IUnknown")
print("=" * 60)

rot = pythoncom.GetRunningObjectTable()
enum = rot.EnumRunning()
index = 0
while True:
    try:
        monikers = enum.Next()
        if not monikers:
            break
        for mk in monikers:
            try:
                dn = mk.GetDisplayName(None, None)
            except Exception:
                dn = "<err>"

            print(f"\n  ROT[{index}]: displayName='{dn}'")
            try:
                # Try to bind and get type info
                obj = rot.GetObject(mk)
                try:
                    disp = obj.QueryInterface(pythoncom.IID_IDispatch)
                    app = win32com.client.Dispatch(disp)
                    try:
                        print(f"    IDispatch: type={type(app)}")
                        # Try common properties
                        for prop in ['Name', 'FullName', 'Path', 'Title', 'Caption', 'Version']:
                            try:
                                val = getattr(app, prop, None)
                                if val is not None:
                                    print(f"    .{prop} = {val}")
                            except Exception:
                                pass
                        # Try to iterate collections
                        for coll in ['Documents', 'Workbooks', 'Presentations', 'Sheets', 'Worksheets']:
                            try:
                                c = getattr(app, coll, None)
                                if c is not None:
                                    print(f"    .{coll}.Count = {c.Count}")
                            except Exception:
                                pass
                    except Exception as e2:
                        print(f"    Dispatch property error: {e2}")
                except Exception:
                    # Try IUnknown
                    try:
                        unk = obj.QueryInterface(pythoncom.IID_IUnknown)
                        print(f"    IUnknown: OK")
                    except Exception:
                        print(f"    Not IDispatch, not IUnknown")
            except Exception as e:
                print(f"    Bind failed: {e}")
            index += 1
    except pywintypes.com_error:
        break

# ==========================================
print("\n" + "=" * 60)
print("3. COM GetActiveObject — probe the WPS server")
print("=" * 60)

# Connect to the ROT-registered WPS COM server
KET_CLSID = "{45540001-5750-5300-4B49-4E47534F4655}"
MS_CLSID = "{00024500-0000-0000-C000-000000000046}"

for label, clsid_str in [("KET", KET_CLSID), ("MS Excel", MS_CLSID)]:
    print(f"\n  [{label}] CLSID={clsid_str}:")
    try:
        clsid = pywintypes.IID(clsid_str)
        obj = pythoncom.GetActiveObject(clsid)
        disp = obj.QueryInterface(pythoncom.IID_IDispatch)
        app = win32com.client.Dispatch(disp)
        print(f"    Version={app.Version}")

        # Try ALL accessible properties
        props_to_try = [
            'Name', 'FullName', 'Path', 'Caption', 'Title',
            'Workbooks', 'Worksheets', 'Sheets', 'Documents', 'Presentations',
            'ActiveWorkbook', 'ActiveDocument', 'ActivePresentation',
            'ActiveSheet', 'ActiveWindow', 'ActiveCell', 'Selection',
            'RecentFiles', 'CommandBars', 'FileDialog',
            'DefaultFilePath', 'TemplatesPath', 'StartupPath',
            'LibraryPath', 'PathSeparator',
            'UserName', 'OrganizationName',
            'Windows', 'WindowState', 'Visible',
            'DisplayAlerts', 'ScreenUpdating', 'EnableEvents',
            'Calculation', 'Cursor', 'StatusBar',
        ]
        for prop in props_to_try:
            try:
                val = getattr(app, prop, None)
                if val is None:
                    continue
                # Try to get a meaningful representation
                if hasattr(val, 'Count'):
                    print(f"    .{prop} (collection): Count={val.Count}")
                    # Try to iterate first few items
                    try:
                        for i in range(1, min(val.Count, 5) + 1):
                            item = val(i)
                            try:
                                item_name = item.Name
                            except Exception:
                                try:
                                    item_name = item.FullName
                                except Exception:
                                    item_name = str(item)
                            print(f"      [{i}] {item_name}")
                    except Exception as e:
                        print(f"      iterate error: {e}")
                elif hasattr(val, 'Name'):
                    try:
                        print(f"    .{prop} = {val}(Name={val.Name})")
                    except Exception:
                        print(f"    .{prop} = {val}")
                elif isinstance(val, (str, int, float, bool)):
                    print(f"    .{prop} = {val}")
                else:
                    print(f"    .{prop} = {val}")
            except Exception as e:
                err_msg = str(e)[:100]
                if '0x' not in err_msg.lower():
                    print(f"    .{prop}: {err_msg}")
    except Exception as e:
        print(f"    FAIL: {e}")

# ==========================================
print("\n" + "=" * 60)
print("4. WPS temp/backup directory search")
print("=" * 60)

# Find WPS temp files
search_dirs = [
    os.path.expandvars(r"%APPDATA%\Kingsoft\Office6"),
    os.path.expandvars(r"%APPDATA%\Kingsoft\wps"),
    os.path.expandvars(r"%APPDATA%\Kingsoft"),
    os.path.expandvars(r"%LOCALAPPDATA%\Kingsoft"),
    os.path.expandvars(r"%TEMP%"),
    os.path.expandvars(r"%TEMP%\Kingsoft"),
    r"D:\software\WPS Office\12.1.0.26895\office6",
]

for d in search_dirs:
    if not os.path.isdir(d):
        print(f"  {d}: NOT FOUND")
        continue
    print(f"\n  {d}:")
    # Look for xlsx files or files matching the temp name
    for root, dirs, files in os.walk(d):
        for f in files:
            full = os.path.join(root, f)
            if any(f.lower().endswith(ext) for ext in ['.xlsx', '.xls', '.xlsm', '.et', '.tmp']):
                if '预警' in f or 'xuejixinx' in f or f.endswith('.tmp'):
                    print(f"    {full}")
        if len(root) - len(d) > 50:  # Don't go too deep
            dirs.clear()

# ==========================================
print("\n" + "=" * 60)
print("5. WPS window atom table (GlobalFindAtom)")
print("=" * 60)

# Windows atoms might store file path
test_strings = ["预警", "xuejixinx", "xlsx", "WPS"]
kernel32 = ctypes.windll.kernel32
for s in test_strings:
    atom = kernel32.GlobalFindAtomW(s)
    if atom:
        print(f"  GlobalFindAtom('{s}') = {atom}")
    else:
        print(f"  GlobalFindAtom('{s}'): not found")

# ==========================================
print("\n" + "=" * 60)
print("6. WPS window message — try WM_GETTEXTLENGTH then WM_GETTEXT with large buffer")
print("=" * 60)

for label, hwnd in [("OpusApp", HWND), ("XLMAIN", XLMAIN_HWND)] + [(f"EXCEL7[{i}]", h) for i, h in enumerate(EXCEL7_HWNDS)]:
    if not hwnd:
        continue
    length = win32gui.SendMessage(hwnd, win32con.WM_GETTEXTLENGTH, 0, 0)
    print(f"  [{label}] WM_GETTEXTLENGTH = {length}")
    if length > 0:
        # Get text with extra large buffer
        buffer_len = max(length * 2 + 2, 4096)
        buffer = ctypes.create_unicode_buffer(buffer_len)
        result = win32gui.SendMessage(hwnd, win32con.WM_GETTEXT, buffer_len, buffer)
        text = buffer.value
        print(f"    WM_GETTEXT (buffer={buffer_len}, result={result}): {text[:200]}")

# ==========================================
print("\n" + "=" * 60)
print("7. WPS document recovery info / Open file handles")
print("=" * 60)

# Check if we can find the open file through Windows API
# Use psutil if available
try:
    import psutil
    proc = psutil.Process(1864)
    print(f"  Process: {proc.name()}")
    print(f"  CWD: {proc.cwd()}")
    open_files = proc.open_files()
    print(f"  Open files: {len(open_files)}")
    for f in open_files:
        if any(f.path.lower().endswith(ext) for ext in ['.xlsx', '.xls', '.xlsm', '.et', '.docx', '.doc']):
            print(f"    FILE: {f.path}")
except ImportError:
    print("  psutil not available")
    # Try via ctypes
    import subprocess
    result = subprocess.run(
        ['wmic', 'process', 'where', 'ProcessId=1864', 'get', 'CommandLine,ExecutablePath', '/format:csv'],
        capture_output=True, text=True, timeout=10
    )
    print(f"  WMIC: {result.stdout}")

# Also use handle.exe from sysinternals if available
try:
    result = subprocess.run(
        ['handle', '-p', '1864', '-accepteula'],
        capture_output=True, text=True, timeout=15
    )
    for line in result.stdout.split('\n'):
        if any(ext in line.lower() for ext in ['xlsx', 'xls', '预警']):
            print(f"  HANDLE: {line.strip()}")
except FileNotFoundError:
    print("  handle.exe not available")

# ==========================================
print("\n" + "=" * 60)
print("8. Check for DDE server in WPS")
print("=" * 60)

import subprocess
# Check if WPS supports DDE
try:
    # Try to query WPS via DDE
    import dde
    print("  dde module available")
except ImportError:
    print("  dde module not available")

# ==========================================
print("\n" + "=" * 60)
print("9. Check WPS COM FileDialog / MsoFileDialog")
print("=" * 60)

# Create a COM server and check FileDialog
try:
    clsid = pywintypes.IID(MS_CLSID)
    obj = pythoncom.CoCreateInstance(
        clsid, None, pythoncom.CLSCTX_ALL, pythoncom.IID_IDispatch,
    )
    app = win32com.client.Dispatch(obj)
    print(f"  Version={app.Version}")

    # Try getting RecentFiles from a different angle
    try:
        rf = app.RecentFiles
        print(f"  RecentFiles.Count={rf.Count}")
        print(f"  RecentFiles.Maximum={rf.Maximum}")
    except Exception as e:
        print(f"  RecentFiles: {e}")

    # Try other file-related properties
    for prop in ['DefaultFilePath', 'TemplatesPath', 'StartupPath',
                 'LibraryPath', 'Path', 'NetworkTemplatesPath',
                 'AutoRecoverPath', 'Autorun', 'AltStartupPath']:
        try:
            print(f"  .{prop} = {getattr(app, prop, '???')}")
        except Exception as e:
            print(f"  .{prop}: {e}")

    # Try FileDialog — might show recently used files
    try:
        fd = app.FileDialog(4)  # msoFileDialogFilePicker = 3, msoFileDialogOpen = 1
        print(f"  FileDialog(4): {fd}")
    except Exception as e:
        print(f"  FileDialog: {e}")

    app.Quit()
except Exception as e:
    print(f"  FAIL: {e}")

# ==========================================
print("\n" + "=" * 60)
print("10. Check WPS config/recent files XML")
print("=" * 60)

wps_config_dirs = [
    os.path.expandvars(r"%APPDATA%\Kingsoft\Office6\data"),
    os.path.expandvars(r"%APPDATA%\Kingsoft\wps\data"),
    os.path.expandvars(r"%APPDATA%\Kingsoft\office6\data"),
    os.path.expandvars(r"%APPDATA%\Kingsoft\wps office\data"),
    os.path.expandvars(r"%LOCALAPPDATA%\Kingsoft\WPS Office\data"),
    os.path.expandvars(r"%LOCALAPPDATA%\Kingsoft\WPS Office\office6\data"),
]

import glob as glob_mod
for d in wps_config_dirs:
    if not os.path.isdir(d):
        continue
    print(f"\n  {d}:")
    for f in sorted(os.listdir(d)):
        full = os.path.join(d, f)
        if os.path.isfile(full) and any(kw in f.lower() for kw in ['recent', 'history', 'mru', 'file', 'list']):
            print(f"    {f} ({os.path.getsize(full)} bytes)")
            try:
                with open(full, 'r', encoding='utf-8', errors='ignore') as fh:
                    content = fh.read(2000)
                print(f"      Content: {content[:500]}...")
                if '预警' in content:
                    print(f"      >>> FOUND '预警' in this file!")
                    # Extract path
                    import re
                    paths = re.findall(r'[A-Za-z]:[\\/][^"\n\r<>*?]+\.xlsx?', content)
                    for p in paths:
                        print(f"      PATH: {p}")
            except Exception:
                pass

print("\nDone.")

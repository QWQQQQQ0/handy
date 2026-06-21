"""Focused: What info does WPS expose for HWND 67380?"""
from __future__ import annotations
import os, sys, struct
import pythoncom, pywintypes
import win32com.client, win32gui, win32con, win32process
import ctypes
from ctypes import wintypes

HWND = 67380

# Find child windows
XLMAIN = None
EXCEL7 = []
def cb(h, _):
    global XLMAIN, EXCEL7
    c = win32gui.GetClassName(h)
    if c == "XLMAIN": XLMAIN = h
    elif c.startswith("EXCEL7"): EXCEL7.append(h)
    return True
win32gui.EnumChildWindows(HWND, cb, None)
print(f"OpusApp={HWND}, XLMAIN={XLMAIN}, EXCEL7={EXCEL7}")

# ==========================================
print("\n" + "=" * 60)
print("1. Window Props via GetProp (common names WPS might use)")
print("=" * 60)

prop_names = [
    "FileName", "FilePath", "DocumentPath", "FullPath",
    "WPSFilePath", "WPSFileName", "ETFilePath",
    "Book", "Workbook", "Document",
    "Caption", "Title",
    "WpsDocPath", "WpsDocName",
    "xlfile", "OleObject", "ETBook",
]
for label, h in [("OpusApp", HWND), ("XLMAIN", XLMAIN)] + [(f"EXCEL7[{i}]", h) for i, h in enumerate(EXCEL7)]:
    if not h: continue
    print(f"\n[{label}] hwnd={h}:")
    for pn in prop_names:
        try:
            v = win32gui.GetProp(h, pn)
            if v:
                print(f"  GetProp('{pn}') = {v} (0x{v:X})")
                # Try to read as string if it's a global atom
        except Exception as e:
            pass  # Property not set

# Also try to read ALL atoms/props via ctypes
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

# Enumerate props using ctypes directly (win32gui doesn't expose EnumProps)
for label, h in [("OpusApp", HWND), ("XLMAIN", XLMAIN)] + [(f"EXCEL7[{i}]", h) for i, h in enumerate(EXCEL7)]:
    if not h: continue
    print(f"\n[{label}] ctypes EnumProps (attempt):")
    props_found = []
    # Use CallWindowProc with EnumProps callback
    # EnumProps only works for atoms (0x0000-0xBFFF), not arbitrary handles

    # Try to enumerate global atoms that might belong to WPS
    # GlobalGetAtomName for common atom range
    for atom_id in range(0xC000, 0xFFFF):  # Global atoms
        try:
            buf = ctypes.create_unicode_buffer(256)
            length = kernel32.GlobalGetAtomNameW(atom_id, buf, 256)
            if length > 0:
                name = buf.value
                # Only print WPS-related atoms
                if any(kw in name.lower() for kw in ['wps', 'et', 'xls', 'doc', 'file', 'path', '预警', 'book']):
                    try:
                        v = win32gui.GetProp(h, name)
                        print(f"  GlobalAtom[{atom_id}] '{name}' = GetProp → {v}")
                        props_found.append(name)
                    except:
                        pass
        except:
            pass

    if not props_found:
        print(f"  (no WPS-related global atom props found)")

# ==========================================
print("\n" + "=" * 60)
print("2. IAccessible / UI Automation check")
print("=" * 60)

# oleacc.AccessibleObjectFromWindow
try:
    oleacc = ctypes.windll.oleacc
    IID_IAccessible = pywintypes.IID("{618736E0-3C3D-11CF-810C-00AA00389B71}")

    for label, h in [("EXCEL7[0]", EXCEL7[0]) if EXCEL7 else ("OpusApp", HWND)]:
        if not h: continue
        ptr = ctypes.c_void_p()
        hr = oleacc.AccessibleObjectFromWindow(
            h, 0, ctypes.byref(IID_IAccessible), ctypes.byref(ptr)
        )
        if hr == 0 and ptr.value:
            print(f"  {label}: IAccessible OK, ptr={ptr.value:#x}")
            # Try to query name/value/path from accessible object
            # This requires IDispatch-based IAccessible, which is complex via ctypes
        else:
            print(f"  {label}: AccessibleObjectFromWindow HRESULT=0x{hr & 0xFFFFFFFF:08X}")
except Exception as e:
    print(f"  oleacc error: {e}")

# Try UI Automation via COM
print()
try:
    import comtypes.client
    from comtypes.gen.UIAutomationClient import CUIAutomation
    uia = comtypes.client.CreateObject("UIAutomationClient.CUIAutomation")
    print(f"  UIA available: {uia}")
    for label, h in [("EXCEL7[0]", EXCEL7[0]) if EXCEL7 else ("OpusApp", HWND)]:
        if not h: continue
        try:
            elem = uia.ElementFromHandle(h)
            print(f"  {label} UIA element: Name='{elem.CurrentName}', Class='{elem.CurrentClassName}'")
            print(f"    ControlType={elem.CurrentControlType}, AutomationId='{elem.CurrentAutomationId}'")
            # Try to get Value pattern
            try:
                from comtypes.gen.UIAutomationClient import UIA_ValuePatternId
                vp = elem.GetCurrentPattern(UIA_ValuePatternId)
                if vp:
                    print(f"    ValuePattern.Value='{vp.CurrentValue}'")
            except:
                pass
            # Try LegacyIAccessible
            try:
                print(f"    LegacyIAccessible.Name='{elem.CurrentLegacyIAccessibleName}'")
                print(f"    LegacyIAccessible.Value='{elem.CurrentLegacyIAccessibleValue}'")
                print(f"    LegacyIAccessible.Description='{elem.CurrentLegacyIAccessibleDescription}'")
            except:
                pass
        except Exception as e:
            print(f"  {label} UIA error: {e}")
except ImportError:
    print("  comtypes not available")
except Exception as e:
    print(f"  UIA error: {e}")

# ==========================================
print("\n" + "=" * 60)
print("3. Probe ROT entries 6 & 7 — maybe they're document objects")
print("=" * 60)

rot = pythoncom.GetRunningObjectTable()
enum = rot.EnumRunning()
idx = 0
while True:
    try:
        monikers = enum.Next()
        if not monikers: break
        for mk in monikers:
            if idx < 6:
                idx += 1
                continue
            print(f"\nROT[{idx}]:")
            try:
                obj = rot.GetObject(mk)
                # Try IDispatch
                try:
                    disp = obj.QueryInterface(pythoncom.IID_IDispatch)
                    app = win32com.client.Dispatch(disp)
                    print(f"  IDispatch OK, type={type(app).__name__}")
                    # Try EVERY possible property
                    for prop in ['Name', 'FullName', 'Path', 'Title', 'Caption',
                                 'Sheets', 'Worksheets', 'Workbooks',
                                 'Slides', 'Presentations', 'Documents',
                                 'ActiveSheet', 'ActiveWorkbook', 'ActiveDocument',
                                 'Saved', 'ReadOnly', 'HasPassword',
                                 'BuiltinDocumentProperties', 'CustomDocumentProperties']:
                        try:
                            v = getattr(app, prop, None)
                            if v is not None:
                                if hasattr(v, 'Count'):
                                    print(f"    .{prop}.Count = {v.Count}")
                                elif isinstance(v, (str, int, float, bool)):
                                    print(f"    .{prop} = {v}")
                        except Exception as e:
                            err = str(e)[:80]
                            if '0x' not in err:
                                print(f"    .{prop}: {err}")
                except Exception as e:
                    print(f"  Not IDispatch: {e}")
                    # Try IOleWindow
                    try:
                        olewin = obj.QueryInterface(pythoncom.IID_IUnknown)
                        print(f"  IUnknown OK")
                    except:
                        print(f"  Not any known interface")
            except Exception as e:
                print(f"  Bind failed: {e}")
            idx += 1
    except pywintypes.com_error:
        break

# ==========================================
print("\n" + "=" * 60)
print("4. WPS COM: FileDialog(open) recent folder hack")
print("=" * 60)

# WPS COM's FileDialog might expose recently used directory
try:
    KET_CLSID = pywintypes.IID("{45540001-5750-5300-4B49-4E47534F4655}")
    obj = pythoncom.GetActiveObject(KET_CLSID)
    disp = obj.QueryInterface(pythoncom.IID_IDispatch)
    app = win32com.client.Dispatch(disp)

    # Try FileDialog with msoFileDialogFilePicker = 3
    for dlg_type in [1, 2, 3, 4]:  # Open, SaveAs, FilePicker, FolderPicker
        try:
            fd = app.FileDialog(dlg_type)
            print(f"  FileDialog({dlg_type}): type={type(fd)}")
            try:
                fd.InitialFileName = "*.xlsx"
                print(f"    InitialFileName set OK")
            except:
                pass
            try:
                print(f"    .Title = {fd.Title}")
            except:
                pass
            try:
                print(f"    .InitialView = {fd.InitialView}")
            except:
                pass
            try:
                print(f"    .ButtonName = {fd.ButtonName}")
            except:
                pass
            # Don't call Show (would open dialog!)
        except Exception as e:
            print(f"  FileDialog({dlg_type}): {str(e)[:100]}")

except Exception as e:
    print(f"  Error: {e}")

# ==========================================
print("\n" + "=" * 60)
print("5. Window messages: try DDE initiate to WPS")
print("=" * 60)

# Check if WPS supports DDE
# Send WM_DDE_INITIATE
try:
    # Try to find the WPS DDE server name
    # Office apps typically use "Excel", "WinWord", "PowerPoint"
    # WPS might use "WPS", "ET", "ETApplication", "KingsoftExcel"
    import win32ui, dde
    print("  dde module check...")
except ImportError:
    print("  dde not available")

# Check using ctypes to send WM_DDE_INITIATE
try:
    WM_DDE_INITIATE = 0x03E0
    HWND_BROADCAST = 0xFFFF

    # The DDE service names for WPS
    # Word: "WPS_Word", "WordDocument"
    # Excel: "ET", "Excel"
    # PPT: "WPP", "PowerPoint"
    print("  DDE service check via window message...")

    # Actually, just check DDE via the WPS process
    import subprocess
    result = subprocess.run(
        ['tasklist', '/m', '/fi', 'PID eq 1864'],
        capture_output=True, text=True, timeout=10
    )
    # Check if dd*.dll is loaded by WPS
    if 'dde' in result.stdout.lower():
        print("  DDE DLLs loaded by WPS!")
    else:
        print("  No DDE DLLs detected in output")

except Exception as e:
    print(f"  DDE check error: {e}")

# ==========================================
print("\n" + "=" * 60)
print("6. Process: open file handles via NtQuerySystemInformation")
print("=" * 60)

# Wait, let's check the WPS process memory for file paths
# This is process-level investigation, not COM
# But it directly answers "what info does WPS expose"

# Actually, let's check WPS COM's Documents/Workbooks/Documents per ROT entry
# Entry 0,1,3,4 are Word (Documents.Count=0)
# Entry 2,5 are Excel (Workbooks.Count=0)
# So ALL ROT entries are the same empty servers

# What about trying to register our OWN COM object in the ROT
# and seeing if WPS communicates with it?
print("  (skip - psutil already showed limited info without admin)")

# ==========================================
print("\n" + "=" * 60)
print("7. Check if WPS has win32gui.GetWindow with specific class names")
print("=" * 60)

# Find ALL WPS windows, not just this HWND
wps_windows = []
def find_wps(h, _):
    if win32gui.IsWindowVisible(h):
        t = win32gui.GetWindowText(h)
        pid = win32process.GetWindowThreadProcessId(h)[1]
        if pid == 1864 or 'WPS' in t or 'wps' in t.lower():
            c = win32gui.GetClassName(h)
            wps_windows.append((h, c, t[:80]))
    return True
win32gui.EnumWindows(find_wps, None)
print(f"All WPS windows (PID 1864):")
for h, c, t in wps_windows:
    print(f"  HWND={h} Class={c} Title='{t}'")

# ==========================================
print("\n" + "=" * 60)
print("8. Check WPS registry for active/open document tracking")
print("=" * 60)

import winreg
# WPS might store the currently open file path in a registry key
wps_active_keys = [
    (winreg.HKEY_CURRENT_USER, r"Software\Kingsoft\Office\6.0\et\ActiveDocument"),
    (winreg.HKEY_CURRENT_USER, r"Software\Kingsoft\Office\6.0\et\Recent File List"),
    (winreg.HKEY_CURRENT_USER, r"Software\Kingsoft\Office\6.0\et\Settings"),
    (winreg.HKEY_CURRENT_USER, r"Software\Kingsoft\Office\6.0\Common\OpenFiles"),
    (winreg.HKEY_CURRENT_USER, r"Software\Kingsoft\WPS\Recent File List"),
    (winreg.HKEY_CURRENT_USER, r"Software\Kingsoft\wps\recent"),
]
for root, sub in wps_active_keys:
    try:
        key = winreg.OpenKey(root, sub, 0, winreg.KEY_READ)
        info = winreg.QueryInfoKey(key)
        print(f"\n  {sub[-60:]}: SubKeys={info[0]}, Values={info[1]}")
        for i in range(min(info[1], 15)):
            name, value, vtype = winreg.EnumValue(key, i)
            val_str = str(value)[:200]
            if '预警' in val_str or 'xlsx' in val_str.lower() or 'zhiyuan' in val_str.lower():
                print(f"    >>> [{i}] {name} = {val_str}")
            else:
                print(f"    [{i}] {name} = {val_str}")
        winreg.CloseKey(key)
    except FileNotFoundError:
        print(f"  NOT FOUND: {sub}")
    except Exception as e:
        print(f"  Error {sub}: {e}")

print("\nDone.")

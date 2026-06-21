# WPS COM 自动化排查报告

## 问题背景

目标：通过 COM 自动化实时读写用户正在 WPS 中编辑的 Word/Excel/PPT 文档。

环境：
- Python 3.14（64-bit）
- WPS Office 12.1.0.26895（32-bit，安装在 `D:\software\WPS Office\`）
- Windows 11

---

## 排查过程

### 1. 注册表扫描 — 成功

**问题**：64-bit Python 的 `pythoncom.CLSIDFromProgID("KWPS.Application")` 无法找到 WPS 的 COM 类。

**根因**：WPS 是 32-bit 程序，COM 类注册在 `HKEY_CLASSES_ROOT\Wow6432Node`（32-bit 注册表视图）。64-bit Python 默认只读 native 视图。

**解决**：用 `winreg.OpenKey()` 配合 `KEY_WOW64_32KEY` 标志主动扫描 32-bit 注册表。

**发现的注册信息**：

| ProgID | CLSID | 注册表视图 | LocalServer32 |
|--------|-------|-----------|---------------|
| `Word.Application` | `{000209FF-0000-0000-C000-000000000046}` | 32-bit | `wps.exe /Automation` |
| `KWPS.Application` | `{000209FF-0000-4b30-A977-D214852036FF}` | 32-bit | `wps.exe /prome...` |
| `Excel.Application` | `{00024500-0000-0000-C000-000000000046}` | 32-bit | `et.exe /Automation` |
| `KET.Application` | `{45540001-5750-5300-4B49-4E47534F4655}` | 32-bit | `wps.exe /prome...` |
| `PowerPoint.Application` | `{91493441-5A91-11CF-8700-00AA0060263B}` | 32-bit | `wpp.exe /Automation` |
| `KWPP.Application` | `{44720441-94BF-4940-926D-4F38FECF2A48}` | 32-bit | `wps.exe /prome...` |

**关键发现**：64-bit 注册表有 ProgID → CLSID 映射，但**没有 LocalServer32**。只有 32-bit 注册表有完整的服务器路径。

---

### 2. GetActiveObject — 拿到空实例

**尝试**：`pythoncom.GetActiveObject(wps_clsid)` 成功返回，但：
```
Documents.Count = 0
Visible = False
Caption = Microsoft Word
```

**根因**：WPS 在 ROT（Running Object Table）中注册的是一个**后台自动化服务器**，不是用户正在编辑文档的那个 UI 进程。

**验证**：枚举 ROT 确认：
```
ROT 条目:
  !{000209FF-0000-0000-C000-000000000046} → Version=12.0, Docs=0
  !{000209FF-0000-4B30-A977-D214852036FF} → Version=12.0, Docs=0
```

两个 CLSID 都注册了，但都是空实例。用户的文档在另一个独立进程中。

---

### 3. GetObject(Class=...) — 无效的类字符串

**尝试**：`win32com.client.GetObject(Class="KWPS.Application")`

**结果**：`(-2147221005, '无效的类字符串')`（`CO_E_CLASSSTRING`）

**根因**：64-bit Python 的 COM 子系统无法通过 ProgID 字符串找到 32-bit 注册的类。`GetObject` 和 `Dispatch` 内部都需要先解析 ProgID → CLSID，这一步在 64-bit 环境下失败。

---

### 4. AccessibleObjectFromWindow — E_FAIL

**尝试**：通过窗口句柄获取 COM 接口
```python
hwnd = 919580  # WPS 窗口 "公告实施配置文档.docx - WPS Office"
oleacc.AccessibleObjectFromWindow(hwnd, OBJID_NATIVEOM, IID_IDispatch, ...)
```

**结果**：`HRESULT: 0x80004005`（E_FAIL）

**根因**：WPS 不支持通过 `OBJID_NATIVEOM`（0xFFFFFFF0）暴露 COM 文档接口。这是 Microsoft Office 的特有行为，WPS 没有实现。

---

### 5. 前台/后台窗口 — 无关

**假设**：WPS 窗口在后台时 COM 不可用。

**验证**：用 `SetForegroundWindow` 将 WPS 切到前台后重试，结果相同。

**结论**：前台/后台不影响 COM 行为。

---

### 6. CoCreateInstance — 创建新实例（关键突破）

**尝试**：
```python
clsid = pywintypes.IID('{000209FF-0000-4b30-A977-D214852036FF}')
obj = pythoncom.CoCreateInstance(clsid, None, pythoncom.CLSCTX_ALL, pythoncom.IID_IDispatch)
app = win32com.client.Dispatch(obj)
```

**结果**：
```
Version = 12.0
Documents.Count = 0
Visible = False
```

**关键发现**：`CoCreateInstance` 创建了一个**新的 WPS 自动化服务器进程**，不是连接到用户已有的实例。但这个实例**可以打开文件**：

```python
app.Visible = True
doc = app.Documents.Open(r'D:\zhiyuan\项目\...\公告实施配置文档.docx')
# 成功！即使用户已经在另一个 WPS 窗口中打开了同一个文件
print(doc.Name)              # 公告实施配置文档.docx
print(doc.Paragraphs.Count)  # 1005
```

---

## 最终解决方案

### 核心原理

```
用户 WPS 进程（UI）     ←→     COM 自动化服务器进程
  显示文档                      打开同一文件
  用户手动编辑                  程序化编辑
       ↕                              ↕
     同一个 .docx 文件（WPS 共享读锁）
```

- WPS 的 COM 自动化服务器和 UI 进程是**分离的**
- 两个进程可以**同时打开同一个文件**（WPS 使用共享读锁）
- COM 实例设置 `Visible=True` 后，用户可以**实时看到**程序化的编辑操作
- 编辑完成后调用 `doc.Save()` 保存，WPS UI 会自动刷新

### 连接策略（按优先级）

| 优先级 | 策略 | 适用场景 |
|--------|------|---------|
| 1 | `GetObject(Class=ProgID)` | MS Office（64-bit 环境） |
| 2 | `GetActiveObject(CLSID)` | MS Office（拿到运行实例） |
| 3 | `CoCreateInstance(CLSID, ALL)` | **WPS（创建自动化服务器）** |
| 4 | 启动 exe + `GetActiveObject` | 兜底 |

对于 WPS，策略 1 和 2 都会失败或返回空实例。**策略 3 是唯一可行路径**。

### 文件操作流程

```
1. office_detect()          → 检测 COM 可用性
2. com_edit(operation=open) → 用文件路径打开文档
3. com_read(...)            → 读取内容
4. com_edit(operation=...)  → 编辑（替换/插入/删除/格式化）
5. com_edit(operation=open) → 打开另一个文件（或继续操作当前文件）
```

---

## 修改的文件

| 文件 | 变更说明 |
|------|---------|
| `python-engine/engine/office/com_resolver.py` | 更新文档说明 WPS 行为；添加 `open_document()` 函数；`connect_app` 为 WPS 自动设置 `Visible=True`；`detect_all` 正确报告 COM 可用性（即使文档为空） |
| `python-engine/engine/office/com_word.py` | 添加 `open(file_path)` 方法 |
| `python-engine/engine/office/com_excel.py` | 添加 `open(file_path)` 方法 |
| `python-engine/engine/office/com_ppt.py` | 添加 `open(file_path)` 方法 |
| `python-engine/main.py` | `word_com_edit`、`excel_com_edit`、`ppt_com_edit` handler 添加 `"open"` 操作 |
| `src/skills/office-doc.ts` | `officeDetect` 改进：区分"COM 可用但无文档"和"有活跃文档" |
| `public/skills/office_doc.md` | 更新文档：添加 `open` 操作、`file_path` 参数、使用流程示例 |

---

## 已验证的功能

| 功能 | Word | Excel | PPT |
|------|------|-------|-----|
| COM 连接 | ✅ | ✅ | ✅ |
| 打开文件 | ✅ | ✅ | ✅ |
| 打开用户已打开的文件 | ✅ | 未测 | 未测 |
| 读取内容 | ✅ (段落/样式) | ✅ (单元格) | 未测 |
| 查找替换 | ✅ | N/A | N/A |
| 插入文本 | ✅ | N/A | N/A |
| 删除段落 | ✅ | N/A | N/A |
| 格式化 | ✅ | N/A | N/A |
| 撤销 | ✅ | N/A | N/A |
| 用户实时可见编辑 | ✅ (Visible=True) | 未测 | 未测 |

---

## 与 MS Office 的差异

| 行为 | Microsoft Office | WPS Office |
|------|-----------------|------------|
| ROT 注册 | 注册运行中的实例 | 注册空的自动化服务器 |
| `GetActiveObject` | 返回用户实例（有文档） | 返回空实例（无文档） |
| `GetObject(Class=)` | 64-bit 可用 | 64-bit 报"无效类字符串" |
| `AccessibleObjectFromWindow` | 支持 OBJID_NATIVEOM | 不支持（E_FAIL） |
| COM 进程 | UI 和 COM 同一进程 | UI 和 COM 分离 |
| 同一文件多实例 | 不允许（文件锁定） | 允许（共享读锁） |

---

## 修复记录

### 2026-06-15: 修复"新开空 WPS 窗口"问题

**问题**：调用 `connect_app` 时，Strategy 2 (`GetActiveObject`) 成功获取 WPS ROT 中的自动化服务器，但因为 `Documents.Count=0`，`_has_running_docs` 返回 False，导致代码回退到 Strategy 3 (`CoCreateInstance`)，创建了一个新的 WPS 进程（即用户看到的空窗口）。

**修复**：
1. `connect_app` 的 Strategy 1/2：移除 `_has_running_docs` 检查，只要连接成功就返回实例（即使文档数为 0）
2. `connect_app` 的 Strategy 3/4：移除 `app.Visible = True`，避免在无文档时显示空窗口
3. `open_document()`：在打开文件后才设置 `app.Visible = True`，确保窗口显示时已有文档加载
4. `detect_all()`：改用 `get_app()` 替代 `connect_app()`，缓存 COM 连接避免重复创建
5. 移除不再使用的 `_has_running_docs()` 函数

**行为变化**：
- `office_detect`：不再触发新 WPS 窗口，仅检测 COM 可用性
- `com_edit(operation='open')`：在打开文档时才显示 WPS 窗口，窗口中有文档内容而非空白
- 若 WPS 未运行：`CoCreateInstance` 创建后台自动化服务器（不可见），后续 `open_document` 才显示

## 注意事项

1. **文件保存**：COM 编辑后需调用 `doc.Save()`，否则修改只在内存中
2. **并发冲突**：如果用户在 WPS UI 中同时编辑同一段落，可能出现冲突
3. **32-bit WPS**：当前方案完全依赖 32-bit WPS 的 COM 注册。如果用户安装了 64-bit WPS，注册表路径会不同
4. **MS Office 优先**：如果同时安装了 MS Office 和 WPS，`_KNOWN_PROGIDS` 的顺序决定了优先使用哪个（当前 MS Office 优先）
5. **进程清理**：`CoCreateInstance` 创建的 WPS 进程在 COM 引用释放后会自动退出
6. **无法直接连接用户已打开的文档**：这是 WPS 的架构限制。COM 自动化服务器和 UI 进程是分离的。解决方法是通过 `open_document()` 在 COM 实例中打开同一文件（WPS 使用共享读锁）

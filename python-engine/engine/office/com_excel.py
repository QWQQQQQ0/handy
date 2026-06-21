"""Excel COM automation — read/edit the active Excel workbook via pywin32."""

from __future__ import annotations

from typing import Any


class ExcelCOM:
    """Operate on the currently active Excel workbook via COM."""

    def _get_app(self):
        from .com_resolver import get_app_with_logic
        return get_app_with_logic("excel")

    def _get_wb(self):
        """Get the active workbook, opening the user's doc via COM if needed."""
        from .com_resolver import (
            get_app, auto_open_user_document, _quit_app, clear_cache,
            _get_wps_pids, _track_com_pids, _move_new_wps_windows_offscreen,
        )
        try:
            app = get_app("excel", connect_only=True)
        except Exception:
            before_pids = _get_wps_pids()
            app = get_app("excel", connect_only=False)
            _track_com_pids(before_pids)
            _move_new_wps_windows_offscreen(before_pids)
        if app.Workbooks.Count == 0:
            try:
                auto_open_user_document(app, "excel")
            except Exception:
                _quit_app(app)
                clear_cache("excel")
                raise
        return app.ActiveWorkbook

    def open(self, file_path: str) -> dict[str, Any]:
        from .com_resolver import (
            get_app, open_document, _quit_app, clear_cache,
            _get_wps_pids, _track_com_pids, _move_new_wps_windows_offscreen,
        )
        try:
            app = get_app("excel", connect_only=True)
        except Exception:
            before_pids = _get_wps_pids()
            app = get_app("excel", connect_only=False)
            _track_com_pids(before_pids)
            _move_new_wps_windows_offscreen(before_pids)
        try:
            wb = open_document(app, file_path, "excel")
        except Exception:
            clear_cache("excel")
            _quit_app(app)
            raise
        return {
            "success": True,
            "title": wb.Name,
            "path": wb.FullName,
            "sheets": [wb.Worksheets(i + 1).Name for i in range(wb.Worksheets.Count)],
        }

    def sync(self) -> dict[str, Any]:
        from .com_resolver import sync_to_user_document
        result = sync_to_user_document("excel")
        if result is None:
            return {"success": False, "message": "未检测到 WPS ET 窗口"}
        return result

    def save(self) -> dict[str, Any]:
        wb = self._get_wb()
        wb.Save()
        return {"success": True, "message": f"已保存 {wb.Name}。WPS 会检测到文件变更并提示重新加载。"}

    def _get_wb_by_path(self, file_path: str):
        """Get a specific workbook by connecting to Excel and matching FullName."""
        import sys
        from .com_resolver import get_app
        sys.stderr.write(f"[excel_com] _get_wb_by_path: file_path={file_path}\n")
        sys.stderr.flush()

        app = get_app("excel", connect_only=True)
        sys.stderr.write(f"[excel_com] connected to Excel, Workbooks.Count={app.Workbooks.Count}\n")
        sys.stderr.flush()

        target = file_path.lower().replace("/", "\\")
        for i, wb in enumerate(app.Workbooks):
            try:
                wb_full = wb.FullName.lower().replace("/", "\\")
                wb_name = wb.Name
                sys.stderr.write(f"[excel_com]   WB[{i+1}]: {wb_name} → {wb_full}\n")
                sys.stderr.flush()
                if wb_full == target:
                    sys.stderr.write(f"[excel_com]   ✓ 匹配成功: {wb_name}\n")
                    sys.stderr.flush()
                    return wb
            except Exception as e:
                sys.stderr.write(f"[excel_com]   WB[{i+1}]: 读取失败 - {e}\n")
                sys.stderr.flush()
                continue

        sys.stderr.write(f"[excel_com] ✗ 未匹配到文件，target={target}\n")
        sys.stderr.flush()
        raise FileNotFoundError(f"未找到已打开的文件: {file_path}")

    def _get_sheet(self, sheet_name: str | None = None, file_path: str | None = None):
        import sys
        sys.stderr.write(f"[excel_com] _get_sheet: sheet={sheet_name}, file_path={file_path}\n")
        sys.stderr.flush()
        if file_path:
            wb = self._get_wb_by_path(file_path)
        else:
            wb = self._get_wb()
        sys.stderr.write(f"[excel_com] _get_sheet: wb={wb.Name}, ActiveSheet={wb.ActiveSheet.Name}\n")
        sys.stderr.flush()
        if sheet_name:
            try:
                ws = wb.Worksheets(sheet_name)
                sys.stderr.write(f"[excel_com] _get_sheet: found sheet '{sheet_name}'\n")
                sys.stderr.flush()
                return ws
            except Exception:
                available = [wb.Worksheets(i + 1).Name for i in range(wb.Worksheets.Count)]
                sys.stderr.write(f"[excel_com] _get_sheet: sheet '{sheet_name}' not found, available={available}\n")
                sys.stderr.flush()
                raise RuntimeError(f"Sheet '{sheet_name}' not found. Available: {available}")
        return wb.ActiveSheet

    def detect(self) -> dict[str, Any]:
        try:
            app = self._get_app()
            wb = app.ActiveWorkbook
            sheets = [wb.Worksheets(i + 1).Name for i in range(wb.Worksheets.Count)]
            return {
                "available": True,
                "title": wb.Name,
                "path": wb.FullName,
                "sheets": sheets,
                "active_sheet": wb.ActiveSheet.Name,
            }
        except Exception as e:
            return {"available": False, "error": str(e)}

    # ── Read ──

    def read_range(self, range_addr: str, sheet: str | None = None, file_path: str | None = None) -> dict[str, Any]:
        import sys
        sys.stderr.write(f"[excel_com] read_range: range={range_addr}, sheet={sheet}, file_path={file_path}\n")
        sys.stderr.flush()
        ws = self._get_sheet(sheet, file_path)
        sys.stderr.write(f"[excel_com] read_range: ws={ws.Name}, calling Range({range_addr})\n")
        sys.stderr.flush()
        rng = ws.Range(range_addr)
        values = rng.Value

        if values is None:
            rows, cols = 0, 0
            data: list[list[Any]] = []
        elif not isinstance(values, (list, tuple)):
            rows, cols = 1, 1
            data = [[values]]
        else:
            data = []
            for row in values:
                if isinstance(row, (list, tuple)):
                    data.append(list(row))
                else:
                    data.append([row])
            rows = len(data)
            cols = len(data[0]) if rows > 0 else 0

        return {
            "workbook": ws.Parent.Name,
            "sheet": ws.Name,
            "values": data,
            "dimensions": {"rows": rows, "cols": cols},
        }

    def get_selection(self) -> dict[str, Any]:
        """Get the COM server's current selection."""
        try:
            wb = self._get_wb()
            ws = wb.ActiveSheet
            selection = wb.Application.Selection
            if selection is None:
                ws.Range("A1").Select()
                selection = wb.Application.Selection
            addr = selection.Address
            values = selection.Value
            data: list[list[Any]] = []
            if values is not None:
                if not isinstance(values, (list, tuple)):
                    data = [[values]]
                else:
                    for row in values:
                        if isinstance(row, (list, tuple)):
                            data.append(list(row))
                        else:
                            data.append([row])
            return {"address": addr, "values": data, "has_selection": True}
        except Exception as e:
            return {"has_selection": False, "message": str(e)}

    def get_sheet_info(self, sheet: str | None = None, file_path: str | None = None) -> dict[str, Any]:
        ws = self._get_sheet(sheet, file_path)
        used = ws.UsedRange
        return {
            "sheet": ws.Name,
            "used_range": used.Address,
            "rows": used.Rows.Count,
            "columns": used.Columns.Count,
        }

    # ── Edit ──

    def _auto_save(self) -> None:
        """Write operations auto-save so the user sees changes immediately."""
        try:
            wb = self._get_wb()
            wb.Save()
        except Exception:
            pass

    def write_range(self, range_addr: str, values: list[list[Any]], sheet: str | None = None) -> dict[str, Any]:
        ws = self._get_sheet(sheet)
        rng = ws.Range(range_addr)
        rng.Value = values
        self._auto_save()
        return {"success": True, "affected_cells": len(values) * (len(values[0]) if values else 0), "message": f"已写入 {range_addr} 并保存"}

    def set_formula(self, cell: str, formula: str, sheet: str | None = None) -> dict[str, Any]:
        ws = self._get_sheet(sheet)
        ws.Range(cell).Formula = formula
        self._auto_save()
        return {"success": True, "affected": 1, "message": f"已设置 {cell} 公式: {formula} 并保存"}

    def auto_fill_column(self, column: str, formula_template: str, start_row: int, end_row: int, sheet: str | None = None) -> dict[str, Any]:
        ws = self._get_sheet(sheet)
        for row in range(start_row, end_row + 1):
            cell = f"{column}{row}"
            formula = formula_template.format(row=row)
            ws.Range(cell).Formula = formula
        count = end_row - start_row + 1
        self._auto_save()
        return {"success": True, "affected_cells": count, "message": f"已填充 {column}{start_row}:{column}{end_row} ({count} 个单元格) 并保存"}

    def set_value(self, cell: str, value: Any, sheet: str | None = None) -> dict[str, Any]:
        ws = self._get_sheet(sheet)
        ws.Range(cell).Value = value
        self._auto_save()
        return {"success": True, "affected": 1, "message": f"已设置 {cell} = {value} 并保存"}

    def format_column(self, column: str, number_format: str | None = None, bold_header: bool = False, sheet: str | None = None) -> dict[str, Any]:
        ws = self._get_sheet(sheet)
        col_range = ws.Columns(column)
        if number_format:
            col_range.NumberFormat = number_format
        if bold_header:
            ws.Range(f"{column}1").Font.Bold = True
        self._auto_save()
        return {"success": True, "message": f"已格式化 {column} 列并保存"}

    def insert_rows(self, after_row: int, count: int = 1, sheet: str | None = None) -> dict[str, Any]:
        ws = self._get_sheet(sheet)
        for _ in range(count):
            ws.Rows(after_row + 1).Insert()
        self._auto_save()
        return {"success": True, "affected": count, "message": f"已在第 {after_row} 行后插入 {count} 行并保存"}

    def insert_columns(self, after_col: int, count: int = 1, sheet: str | None = None) -> dict[str, Any]:
        ws = self._get_sheet(sheet)
        for _ in range(count):
            ws.Columns(after_col + 1).Insert()
        self._auto_save()
        return {"success": True, "affected": count, "message": f"已在第 {after_col} 列后插入 {count} 列并保存"}

"""Word COM automation — read/edit the active Word document via pywin32."""

from __future__ import annotations

from typing import Any


class WordCOM:
    """Operate on the currently active Word document via COM."""

    def _get_app(self):
        from .com_resolver import get_app_with_logic
        return get_app_with_logic("word")

    def _get_doc(self):
        """Get the active document, opening the user's doc via COM if needed."""
        from .com_resolver import (
            get_app, auto_open_user_document, _quit_app, clear_cache,
            _get_wps_pids, _track_com_pids, _move_new_wps_windows_offscreen,
        )
        try:
            app = get_app("word", connect_only=True)
        except Exception:
            before_pids = _get_wps_pids()
            app = get_app("word", connect_only=False)
            _track_com_pids(before_pids)
            _move_new_wps_windows_offscreen(before_pids)
        if app.Documents.Count == 0:
            try:
                auto_open_user_document(app, "word")
            except Exception:
                _quit_app(app)
                clear_cache("word")
                raise
        return app.ActiveDocument

    def open(self, file_path: str) -> dict[str, Any]:
        from .com_resolver import (
            get_app, open_document, _quit_app, clear_cache,
            _get_wps_pids, _track_com_pids, _move_new_wps_windows_offscreen,
        )
        try:
            app = get_app("word", connect_only=True)
        except Exception:
            before_pids = _get_wps_pids()
            app = get_app("word", connect_only=False)
            _track_com_pids(before_pids)
            _move_new_wps_windows_offscreen(before_pids)
        try:
            doc = open_document(app, file_path, "word")
        except Exception:
            clear_cache("word")
            _quit_app(app)
            raise
        return {
            "success": True,
            "title": doc.Name,
            "path": doc.FullName,
            "paragraph_count": doc.Paragraphs.Count,
        }

    def sync(self) -> dict[str, Any]:
        from .com_resolver import sync_to_user_document
        result = sync_to_user_document("word")
        if result is None:
            return {"success": False, "message": "未检测到 WPS Writer 窗口"}
        return result

    def save(self) -> dict[str, Any]:
        doc = self._get_doc()
        doc.Save()
        return {"success": True, "message": f"已保存 {doc.Name}。WPS 会检测到文件变更并提示重新加载。"}

    def detect(self) -> dict[str, Any]:
        try:
            app = self._get_app()
            doc = app.ActiveDocument
            return {
                "available": True,
                "title": doc.Name,
                "path": doc.FullName,
                "paragraph_count": doc.Paragraphs.Count,
            }
        except Exception as e:
            return {"available": False, "error": str(e)}

    # ── Read ──

    def read_content(self, paragraph_start: int | None = None, paragraph_end: int | None = None) -> dict[str, Any]:
        doc = self._get_doc()
        total = doc.Paragraphs.Count
        start = max(1, paragraph_start or 1)
        end = min(total, paragraph_end or total)
        paragraphs = []
        for i in range(start, end + 1):
            p = doc.Paragraphs(i)
            text = p.Range.Text.rstrip('\r\n')
            if text.strip():
                paragraphs.append({"index": i, "text": text, "style": str(p.Style)})
        return {"title": doc.Name, "paragraphs": paragraphs, "total_paragraphs": total}

    def get_selection(self) -> dict[str, Any]:
        try:
            app = self._get_app()
            selection = app.Selection
            if selection is None:
                return {"text": "", "has_selection": False}
            text = selection.Text
            return {"text": text, "has_selection": len(text.strip()) > 0 if text else False}
        except Exception as e:
            return {"text": "", "has_selection": False, "message": str(e)}

    # ── Edit ──

    def _auto_save(self) -> None:
        """Write operations auto-save so the user sees changes immediately."""
        try:
            doc = self._get_doc()
            doc.Save()
        except Exception:
            pass

    def replace_text(self, find: str, replace: str) -> dict[str, Any]:
        doc = self._get_doc()
        find_obj = doc.Content.Find
        find_obj.ClearFormatting()
        find_obj.Replacement.ClearFormatting()
        find_obj.Text = find
        find_obj.Replacement.Text = replace
        find_obj.Execute(Replace=2)  # wdReplaceAll
        self._auto_save()
        return {"success": True, "message": f"已替换 '{find}' → '{replace}' 并保存"}

    def set_paragraph(self, paragraph_index: int, text: str) -> dict[str, Any]:
        doc = self._get_doc()
        doc.Paragraphs(paragraph_index).Range.Text = text + '\r\n'
        self._auto_save()
        return {"success": True, "message": f"已设置第 {paragraph_index} 段并保存"}

    def insert_text(self, after_paragraph: int, text: str) -> dict[str, Any]:
        doc = self._get_doc()
        rng = doc.Paragraphs(after_paragraph).Range
        rng.Collapse(0)  # wdCollapseEnd
        rng.Text = '\r\n' + text + '\r\n'
        self._auto_save()
        return {"success": True, "message": f"已在第 {after_paragraph} 段后插入文本并保存"}

    def insert_heading(self, after_paragraph: int, text: str, level: int = 1) -> dict[str, Any]:
        doc = self._get_doc()
        rng = doc.Paragraphs(after_paragraph).Range
        rng.Collapse(0)
        rng.Text = '\r\n' + text + '\r\n'
        rng.Paragraphs(1).Style = f"Heading {level}"
        self._auto_save()
        return {"success": True, "message": f"已在第 {after_paragraph} 段后插入标题并保存"}

    def delete_paragraph(self, paragraph_index: int) -> dict[str, Any]:
        doc = self._get_doc()
        doc.Paragraphs(paragraph_index).Range.Delete()
        self._auto_save()
        return {"success": True, "message": f"已删除第 {paragraph_index} 段并保存"}

    def apply_format(self, paragraph_index: int, bold: bool | None = None, italic: bool | None = None, font_size: int | None = None) -> dict[str, Any]:
        doc = self._get_doc()
        rng = doc.Paragraphs(paragraph_index).Range
        if bold is not None:
            rng.Font.Bold = bold
        if italic is not None:
            rng.Font.Italic = italic
        if font_size is not None:
            rng.Font.Size = font_size
        self._auto_save()
        return {"success": True, "message": f"已格式化第 {paragraph_index} 段并保存"}

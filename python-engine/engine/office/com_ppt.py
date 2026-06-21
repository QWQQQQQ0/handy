"""PowerPoint COM automation — read/edit the active PPT presentation via pywin32."""

from __future__ import annotations

from typing import Any


class PptCOM:
    """Operate on the currently active PowerPoint presentation via COM."""

    def _get_app(self):
        from .com_resolver import get_app_with_logic
        return get_app_with_logic("ppt")

    def _get_pres(self):
        """Get the active presentation, opening the user's doc via COM if needed."""
        from .com_resolver import (
            get_app, auto_open_user_document, _quit_app, clear_cache,
            _get_wps_pids, _track_com_pids, _move_new_wps_windows_offscreen,
        )
        try:
            app = get_app("ppt", connect_only=True)
        except Exception:
            before_pids = _get_wps_pids()
            app = get_app("ppt", connect_only=False)
            _track_com_pids(before_pids)
            _move_new_wps_windows_offscreen(before_pids)
        if app.Presentations.Count == 0:
            try:
                auto_open_user_document(app, "ppt")
            except Exception:
                _quit_app(app)
                clear_cache("ppt")
                raise
        return app.ActivePresentation

    def open(self, file_path: str) -> dict[str, Any]:
        from .com_resolver import (
            get_app, open_document, _quit_app, clear_cache,
            _get_wps_pids, _track_com_pids, _move_new_wps_windows_offscreen,
        )
        try:
            app = get_app("ppt", connect_only=True)
        except Exception:
            before_pids = _get_wps_pids()
            app = get_app("ppt", connect_only=False)
            _track_com_pids(before_pids)
            _move_new_wps_windows_offscreen(before_pids)
        try:
            pres = open_document(app, file_path, "ppt")
        except Exception:
            clear_cache("ppt")
            _quit_app(app)
            raise
        return {
            "success": True,
            "title": pres.Name,
            "path": pres.FullName,
            "slide_count": pres.Slides.Count,
        }

    def sync(self) -> dict[str, Any]:
        from .com_resolver import sync_to_user_document
        result = sync_to_user_document("ppt")
        if result is None:
            return {"success": False, "message": "未检测到 WPS 演示窗口"}
        return result

    def save(self) -> dict[str, Any]:
        pres = self._get_pres()
        pres.Save()
        return {"success": True, "message": f"已保存 {pres.Name}。WPS 会检测到文件变更并提示重新加载。"}

    def detect(self) -> dict[str, Any]:
        try:
            app = self._get_app()
            pres = app.ActivePresentation
            return {
                "available": True,
                "title": pres.Name,
                "path": pres.FullName,
                "slide_count": pres.Slides.Count,
            }
        except Exception as e:
            return {"available": False, "error": str(e)}

    # ── Read ──

    def read_content(self, slide_start: int | None = None, slide_end: int | None = None) -> dict[str, Any]:
        pres = self._get_pres()
        total = pres.Slides.Count
        start = max(1, slide_start or 1)
        end = min(total, slide_end or total)
        slides = []
        for i in range(start, end + 1):
            slide = pres.Slides(i)
            shapes_data = []
            for shape in slide.Shapes:
                if shape.HasTextFrame and shape.TextFrame.HasText:
                    shapes_data.append({
                        "name": shape.Name,
                        "text": shape.TextFrame.TextRange.Text,
                    })
            slides.append({"index": i, "shapes": shapes_data})
        return {"title": pres.Name, "slides": slides, "total_slides": total}

    def read_slide(self, slide_index: int | None = None) -> dict[str, Any]:
        pres = self._get_pres()
        idx = slide_index or 1
        slide = pres.Slides(idx)
        shapes_data = []
        for shape in slide.Shapes:
            item = {"name": shape.Name, "type": str(shape.Type)}
            if shape.HasTextFrame and shape.TextFrame.HasText:
                item["text"] = shape.TextFrame.TextRange.Text
            shapes_data.append(item)
        return {"title": pres.Name, "slide_index": idx, "shapes": shapes_data}

    def find_text_shapes(self, slide_index: int | None = None) -> dict[str, Any]:
        pres = self._get_pres()
        idx = slide_index or 1
        slide = pres.Slides(idx)
        text_shapes = []
        for shape in slide.Shapes:
            if shape.HasTextFrame and shape.TextFrame.HasText:
                text_shapes.append({
                    "name": shape.Name,
                    "text": shape.TextFrame.TextRange.Text,
                })
        return {"slide_index": idx, "text_shapes": text_shapes}

    # ── Edit ──

    def _auto_save(self) -> None:
        """Write operations auto-save so the user sees changes immediately."""
        try:
            pres = self._get_pres()
            pres.Save()
        except Exception:
            pass

    def set_slide_text(self, slide_index: int, shape_name: str, text: str) -> dict[str, Any]:
        pres = self._get_pres()
        slide = pres.Slides(slide_index)
        shape = slide.Shapes(shape_name)
        shape.TextFrame.TextRange.Text = text
        self._auto_save()
        return {"success": True, "message": f"已设置 slide {slide_index} 的 {shape_name} 并保存"}

    def add_slide(self, layout_index: int = 1, title: str | None = None, content: str | None = None, after_slide: int | None = None) -> dict[str, Any]:
        pres = self._get_pres()
        layout = pres.Designs(1).SlideMaster.CustomLayouts(layout_index)
        if after_slide:
            slide = pres.Slides.AddSlide(after_slide + 1, layout)
        else:
            slide = pres.Slides.AddSlide(pres.Slides.Count + 1, layout)
        if title:
            slide.Shapes(1).TextFrame.TextRange.Text = title
        if content:
            slide.Shapes(2).TextFrame.TextRange.Text = content
        self._auto_save()
        return {"success": True, "slide_index": slide.SlideIndex, "message": "已添加幻灯片并保存"}

    def delete_slide(self, slide_index: int) -> dict[str, Any]:
        pres = self._get_pres()
        pres.Slides(slide_index).Delete()
        self._auto_save()
        return {"success": True, "message": f"已删除 slide {slide_index} 并保存"}

    def reorder_slides(self, new_order: list[int]) -> dict[str, Any]:
        pres = self._get_pres()
        for i, slide_num in enumerate(new_order):
            pres.Slides(slide_num).MoveTo(i + 1)
        self._auto_save()
        return {"success": True, "message": "已重新排序幻灯片并保存"}

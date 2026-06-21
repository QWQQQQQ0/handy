"""Fast screenshot capture via mss (replaces GDI BMP).

Returns PNG base64 — smaller and faster than the old BMP approach.
"""

from __future__ import annotations

import base64
import io
import traceback
from typing import Any

try:
    import mss
    from PIL import Image
    HAS_MSS = True
except ImportError:
    HAS_MSS = False


class ScreenshotEngine:
    """Wraps mss for fast screen capture."""

    def __init__(self) -> None:
        if not HAS_MSS:
            raise RuntimeError(
                "mss and Pillow are required. Run: pip install mss Pillow"
            )
        self._sct = mss.mss()

    def _capture_to_base64(self, img) -> tuple[str, int, int]:
        """将 mss 截图转换为 base64，及时释放中间缓冲区"""
        # 直接从 raw 数据创建 PIL Image，避免额外拷贝
        pil = Image.frombytes("RGB", img.size, img.bgra, "raw", "BGRX")
        # 使用较低质量的 PNG 压缩减少内存
        buf = io.BytesIO()
        pil.save(buf, format="PNG", optimize=True, compress_level=6)
        # 立即释放 PIL Image
        del pil
        # 获取 PNG 数据并编码为 base64
        png_data = buf.getvalue()
        data_url = "data:image/png;base64," + base64.b64encode(png_data).decode()
        # 释放缓冲区
        del buf, png_data
        return data_url, img.size[0], img.size[1]

    def full(self) -> dict[str, Any]:
        """Capture the entire primary monitor."""
        try:
            monitor = self._sct.monitors[1]  # primary
            img = self._sct.grab(monitor)
            data_url, width, height = self._capture_to_base64(img)
            return {
                "image_data": data_url,
                "format": "png",
                "width": width,
                "height": height,
            }
        except Exception:
            return {"image_data": "", "error": traceback.format_exc()}

    def region(self, left: int, top: int, width: int, height: int) -> dict[str, Any]:
        """Capture a specific screen region."""
        try:
            region = {"left": left, "top": top, "width": width, "height": height}
            img = self._sct.grab(region)
            data_url, w, h = self._capture_to_base64(img)
            return {
                "image_data": data_url,
                "format": "png",
                "width": w,
                "height": h,
                "region": {"left": left, "top": top, "width": width, "height": height},
            }
        except Exception:
            return {"image_data": "", "error": traceback.format_exc()}

    def all_monitors(self) -> dict[str, Any]:
        """Return monitor layout info."""
        monitors = []
        for i, m in enumerate(self._sct.monitors):
            monitors.append({
                "index": i,
                "left": m["left"], "top": m["top"],
                "width": m["width"], "height": m["height"],
            })
        return {"monitors": monitors}

"""Event Collector — unified backend for all input events.

Receives events from:
1. Global listener (pynput) — system-wide mouse/keyboard
2. Extension (WebSocket) — browser DOM events

Architecture:
  Merge buffer (50ms window) — matches extension + global events by type/time
  poll() — returns merged raw events, sorted by timestamp

Gesture classification is done by the frontend.
"""

import sys
import time
import threading
from collections import deque
from typing import Any


def _log(msg: str) -> None:
    pass  # 静默，调试时改回 print


# ── Merge window ──
MERGE_WINDOW_MS = 0.050  # 50ms window to match extension + global events


class EventCollector:
    """Unified event collector with real-time merge buffer."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._recording = False

        # Merge buffer
        self._merge_pending: dict[str, dict] = {}
        self._merge_timers: dict[str, threading.Timer] = {}

        # Output buffer (merged events ready for poll)
        self._output: list[dict] = []

    def start_recording(self) -> None:
        self._recording = True
        with self._lock:
            self._output.clear()
            self._merge_pending.clear()
            for t in self._merge_timers.values():
                t.cancel()
            self._merge_timers.clear()

    def stop_recording(self) -> None:
        self._recording = False
        _log("recording stopped")

    @property
    def is_recording(self) -> bool:
        return self._recording

    # ── Event type mapping ──
    _TYPE_MAP: dict[str, str] = {
        "mousedown": "mouse_down",
        "mouseup": "mouse_up",
    }
    _TYPE_MAP_REV: dict[str, str] = {v: k for k, v in _TYPE_MAP.items()}

    # ── Event entry points ──

    def put_global_event(self, event: dict) -> None:
        if not self._recording:
            return
        now_ms = int(time.time() * 1000)
        event["_source"] = "global"
        event["_collected_at"] = now_ms
        evt_type = event.get("event_type", "")

        if evt_type in ("mouse_down", "mouse_up"):
            _log(f"[GLOBAL] {evt_type} x={event.get('x')} y={event.get('y')} collected_at={now_ms}")
            self._add_to_merge_buffer(event, "global", evt_type)
        else:
            with self._lock:
                self._output.append(event)
                _log(f"[BUFFER] +global {evt_type}, size={len(self._output)}")

    def put_extension_event(self, event: dict) -> None:
        if not self._recording:
            return
        now_ms = int(time.time() * 1000)
        event["_source"] = "extension"
        event["_collected_at"] = now_ms
        evt_type = event.get("type", "")

        if evt_type in ("mousedown", "mouseup"):
            _log(f"[EXTENSION] {evt_type} x={event.get('x')} y={event.get('y')} collected_at={now_ms}")
            self._add_to_merge_buffer(event, "extension", evt_type)
        else:
            with self._lock:
                self._output.append(event)

    # ── Merge buffer ──

    def _add_to_merge_buffer(self, event: dict, source: str, evt_type: str) -> None:
        with self._lock:
            # Unified key for matching
            if source == "global":
                counterpart = self._TYPE_MAP_REV.get(evt_type)
            else:
                counterpart = self._TYPE_MAP.get(evt_type)
            match_key = f"ext_{evt_type}" if source == "extension" else f"ext_{counterpart}"

            if match_key in self._merge_pending:
                # Match found
                counterpart_evt = self._merge_pending.pop(match_key)
                if self._merge_timers.get(match_key):
                    self._merge_timers[match_key].cancel()
                    del self._merge_timers[match_key]
                merged = self._do_merge(event, counterpart_evt, source)
                self._output.append(merged)
                _log(f"[MERGED→BUFFER] {merged.get('type')} size={len(self._output)}")
            else:
                # No match yet, buffer with 50ms timeout
                self._merge_pending[match_key] = event

                lock = self._lock
                pending = self._merge_pending
                output = self._output

                def _on_timeout():
                    with lock:
                        evt = pending.pop(match_key, None)
                        self._merge_timers.pop(match_key, None)
                        if evt:
                            # 归一化：扩展事件用 type，映射为 event_type
                            if evt.get("_source") == "extension" and evt.get("type"):
                                evt["event_type"] = self._TYPE_MAP.get(evt["type"], evt["type"])
                            output.append(evt)
                            evt_type = evt.get("event_type", evt.get("type", ""))
                            _log(f"[TIMEOUT→BUFFER] {evt_type} x={evt.get('x')} y={evt.get('y')}, size={len(output)}")

                timer = threading.Timer(MERGE_WINDOW_MS, _on_timeout)
                timer.daemon = True
                self._merge_timers[match_key] = timer
                timer.start()

    def _do_merge(self, event_a: dict, event_b: dict, first_source: str) -> dict:
        if first_source == "global":
            global_evt, ext_evt = event_a, event_b
        else:
            global_evt, ext_evt = event_b, event_a

        ext_evt["global_x"] = global_evt["x"]
        ext_evt["global_y"] = global_evt["y"]
        ext_evt["hwnd"] = global_evt.get("hwnd", 0)
        ext_evt["window_title"] = global_evt.get("window_title", "")
        # 统一字段名：扩展用 type，全局用 event_type，归一化为 event_type
        ext_type = ext_evt.get("type", "")
        if ext_type:
            ext_evt["event_type"] = self._TYPE_MAP.get(ext_type, ext_type)

        _log(f"[MERGED] {ext_evt.get('type')} "
             f"ext=({ext_evt.get('screenX')},{ext_evt.get('screenY')}) "
             f"→ global=({global_evt['x']},{global_evt['y']})")
        return ext_evt

    # ── poll() ──

    def poll(self, max_events: int = 50) -> list[dict]:
        with self._lock:
            buf_size = len(self._output)
            result = self._output[:max_events]
            del self._output[:max_events]
        result.sort(key=lambda e: e.get("_collected_at", 0))
        if result:
            _log(f"[POLL] returning {len(result)} events, buffer had {buf_size}")
        for evt in result:
            evt_type = evt.get("event_type", evt.get("type", ""))
            src = evt.get("_source", "")
            _log(f"[POLL→] {src} {evt_type} x={evt.get('x')} y={evt.get('y')} collected_at={evt.get('_collected_at')}")
        return result

    def get_status(self) -> dict:
        with self._lock:
            queue_size = len(self._output)
        return {"recording": self._recording, "queue_size": queue_size}


_collector: EventCollector | None = None


def get_collector() -> EventCollector:
    global _collector
    if _collector is None:
        _collector = EventCollector()
    return _collector

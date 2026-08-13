"""DOM event recording mixin for BrowserEngine.

Extracted from browser.py to keep the main engine file manageable.
Provides JS injection scripts and recording methods used by the
BrowserEngine class via mixin inheritance.
"""

from __future__ import annotations

import time
import traceback
from typing import Any

try:
    from playwright.sync_api import Page
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

# ── JS code injected into the page to capture DOM events ──

_RECORD_LISTENERS_JS = """() => {
    if (window.__handy_recording) return;  // already injected
    window.__handy_recording = true;
    window.__handy_event_buffer = [];

    function getElementInfo(el) {
        if (!el || el === document.documentElement || el === document.body) return null;
        const r = el.getBoundingClientRect();

        // Build best selector (priority: id > aria-label > text > css)
        let selector = '';
        if (el.id) {
            selector = '#' + CSS.escape(el.id);
        } else if (el.getAttribute('aria-label')) {
            selector = el.tagName.toLowerCase() + '[aria-label="' + CSS.escape(el.getAttribute('aria-label')) + '"]';
        } else if (el.className && typeof el.className === 'string') {
            const classes = el.className.trim().split(/\\s+/).filter(c => c).map(c => '.' + CSS.escape(c)).join('');
            selector = el.tagName.toLowerCase() + classes;
        }

        // Get accessible name
        const name = el.getAttribute('aria-label')
            || el.getAttribute('title')
            || el.getAttribute('placeholder')
            || el.getAttribute('alt')
            || (el.textContent || '').trim().substring(0, 80);

        // Get ARIA role
        const role = el.getAttribute('role')
            || (el.tagName === 'BUTTON' ? 'button' : '')
            || (el.tagName === 'A' ? 'link' : '')
            || (el.tagName === 'INPUT' ? (el.type || 'textbox') : '')
            || (el.tagName === 'SELECT' ? 'combobox' : '')
            || (el.tagName === 'TEXTAREA' ? 'textbox' : '');

        return {
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().substring(0, 120),
            selector: selector,
            role: role,
            name: name,
            bounds: {
                x: Math.round(r.left), y: Math.round(r.top),
                width: Math.round(r.width), height: Math.round(r.height)
            }
        };
    }

    // Physical screen size (set by Python backend, used for coordinate correction)
    if (!window.__handy_physical_screen) {
        window.__handy_physical_screen = { width: 0, height: 0 };
    }

    function pushEvent(type, e, extra) {
        const info = e ? getElementInfo(e.target) : null;
        const eventData = {
            type: type,
            timestamp: Date.now(),
            x: e ? e.clientX : 0,
            y: e ? e.clientY : 0,
            // Screen coordinates (for cross-DPI scaling)
            screenX: e ? e.screenX : 0,
            screenY: e ? e.screenY : 0,
            // Browser's logical screen size
            screenWidth: screen.width,
            screenHeight: screen.height,
            // Physical screen size from backend (for coordinate correction)
            physicalWidth: window.__handy_physical_screen.width,
            physicalHeight: window.__handy_physical_screen.height,
            element: info,
            key: extra && extra.key ? extra.key : undefined,
            modifiers: extra && extra.modifiers ? extra.modifiers : undefined,
            value: extra && extra.value !== undefined ? extra.value : undefined,
            url: location.href,
            title: document.title,
        };
        // Push to Python if exposed (real-time path)
        if (window.__handy_push_event) {
            try {
                window.__handy_push_event(eventData);
            } catch(e) {
                console.warn('[Handy] __handy_push_event call failed, buffering:', e);
                window.__handy_event_buffer.push(eventData);
            }
        } else {
            // Buffer as fallback when push function not available
            window.__handy_event_buffer.push(eventData);
        }
    }

    document.addEventListener('click', function(e) { pushEvent('click', e); }, true);
    document.addEventListener('dblclick', function(e) { pushEvent('dblclick', e); }, true);
    document.addEventListener('contextmenu', function(e) { pushEvent('contextmenu', e); }, true);
    document.addEventListener('keydown', function(e) {
        const mods = [];
        if (e.ctrlKey) mods.push('Ctrl');
        if (e.altKey) mods.push('Alt');
        if (e.shiftKey) mods.push('Shift');
        if (e.metaKey) mods.push('Meta');
        pushEvent('keydown', e, { key: e.key, modifiers: mods });
    }, true);
    document.addEventListener('input', function(e) {
        pushEvent('input', e, { value: e.target.value });
    }, true);
}"""

_REMOVE_LISTENERS_JS = """() => {
    window.__handy_recording = false;
    window.__handy_event_buffer = [];
}"""


class BrowserRecordingMixin:
    """Recording methods mixed into BrowserEngine.

    Requires the host class to provide:
      - self._page (Playwright Page | None)
      - self._recording_active (bool)
      - self._recorded_events (list[dict])
      - self._event_handler_ref (callable | None)
    """

    _page: Any = None
    _recording_active: bool = False
    _recorded_events: list[dict[str, Any]] = []
    _event_handler_ref: Any = None

    def _inject_physical_screen_size(self) -> None:
        """Inject physical screen size into page for coordinate correction."""
        if not self._page:
            return
        try:
            import ctypes
            user32 = ctypes.windll.user32
            w = user32.GetSystemMetrics(0)  # SM_CXSCREEN
            h = user32.GetSystemMetrics(1)  # SM_CYSCREEN
            self._page.evaluate(
                f"() => {{ window.__handy_physical_screen = {{ width: {w}, height: {h} }}; }}"
            )
        except Exception:
            pass

    def start_recording(self) -> dict[str, Any]:
        """Inject DOM event listeners into the current page and start recording."""
        if not self._page:
            return {"recording": False, "error": "Browser not launched"}
        try:
            self._recorded_events = []
            self._recording_active = True

            # Expose Python callback so JS can push events in real-time
            # (expose_function persists across same-origin navigations)
            if not self._event_handler_ref:
                def on_event(event_data: dict) -> None:
                    if self._recording_active:
                        event_data["_received_at"] = time.time()
                        self._recorded_events.append(event_data)

                self._event_handler_ref = on_event

            # Always try to expose — handle both first-time and re-expose
            try:
                self._page.expose_function("__handy_push_event", self._event_handler_ref)
            except Exception as e:
                # Already exposed from previous session — verify it's callable
                if "already registered" in str(e).lower() or "already exposed" in str(e).lower():
                    pass  # OK, the existing binding will work
                else:
                    # Unexpected error — reset ref so next attempt retries
                    self._event_handler_ref = None
                    return {"recording": False, "error": f"Failed to expose event function: {e}"}

            # Inject listeners into current page
            self._page.evaluate(_RECORD_LISTENERS_JS)

            # Inject physical screen size for coordinate correction
            self._inject_physical_screen_size()

            # Verify injection succeeded
            is_injected = self._page.evaluate("() => !!window.__handy_recording")
            has_push_fn = self._page.evaluate("() => typeof window.__handy_push_event === 'function'")
            if not is_injected:
                return {"recording": False, "error": "JS listener injection failed"}
            if not has_push_fn:
                return {"recording": False, "error": "expose_function binding not available — __handy_push_event is not a function"}

            # Re-inject on page navigation (same-origin loads)
            def on_load(page: Page) -> None:
                try:
                    page.evaluate(_RECORD_LISTENERS_JS)
                    self._inject_physical_screen_size()
                except Exception:
                    pass

            self._page.on("load", on_load)

            return {"recording": True, "url": self._page.url}
        except Exception:
            return {"recording": False, "error": traceback.format_exc()}

    def stop_recording(self) -> dict[str, Any]:
        """Remove event listeners and return all recorded events."""
        if not self._page:
            return {"events": self._recorded_events, "count": len(self._recorded_events)}
        try:
            self._recording_active = False
            # Try to remove listeners from page
            try:
                self._page.evaluate(_REMOVE_LISTENERS_JS)
            except Exception:
                pass
            # Collect any remaining events from the page buffer
            try:
                buffer = self._page.evaluate("() => window.__handy_event_buffer || []")
                for evt in buffer:
                    evt["_received_at"] = time.time()
                    self._recorded_events.append(evt)
            except Exception:
                pass
            return {
                "events": self._recorded_events,
                "count": len(self._recorded_events),
            }
        except Exception:
            return {"events": self._recorded_events, "count": len(self._recorded_events), "error": traceback.format_exc()}

    def get_recorded_events(self) -> dict[str, Any]:
        """Return newly recorded events since last call and clear the buffer.

        Also drains the JS-side buffer as a fallback (in case __handy_push_event
        is unavailable, e.g. after cross-origin navigation).
        """
        # Drain JS buffer as fallback
        if self._page and self._recording_active:
            try:
                js_events = self._page.evaluate(
                    "() => { const buf = window.__handy_event_buffer || []; window.__handy_event_buffer = []; return buf; }"
                )
                for evt in js_events:
                    evt["_received_at"] = time.time()
                    self._recorded_events.append(evt)
            except Exception:
                pass  # page may have navigated away

        events = list(self._recorded_events)
        self._recorded_events = []
        return {"events": events, "count": len(events)}

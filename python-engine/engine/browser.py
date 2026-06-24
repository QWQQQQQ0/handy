"""Browser automation via Playwright.

Provides: launch, navigate, DOM + Accessibility Tree extraction,
click by selector/role, fill/type text, scroll, close,
and DOM event recording for automation recording.
"""

from __future__ import annotations

import os
import sys
import time
import traceback
from typing import Any

try:
    from playwright.sync_api import sync_playwright, Page, Browser as PWBrowser
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

# JS code injected into the page to capture DOM events with semantic info
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
        // 使用 Date.now() 获取当前 Unix 毫秒时间戳，和 Rust 的 SystemTime::now() 一致
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


class BrowserEngine:
    """Wraps Playwright for web automation."""

    # 空闲超时：5 分钟无操作自动关闭浏览器
    IDLE_TIMEOUT_SECONDS = 300

    def __init__(self) -> None:
        if not HAS_PLAYWRIGHT:
            raise RuntimeError(
                "Playwright is not installed. Run: pip install playwright"
            )
        self._playwright = None
        self._browser: PWBrowser | None = None
        self._page: Page | None = None
        # Recording state
        self._recording_active: bool = False
        self._recorded_events: list[dict[str, Any]] = []
        self._event_handler_ref: Any = None  # reference to exposed function
        # Tab monitoring state
        self._cdp_session: Any = None
        self._last_active_target_id: str | None = None
        self._target_id_to_page: dict[str, Page] = {}
        # 空闲超时
        self._last_activity_time: float = 0
        self._idle_timer: Any = None

    def _cleanup_playwright(self) -> None:
        """Clean up any existing Playwright instance without throwing."""
        if self._cdp_session:
            try:
                self._cdp_session.detach()
            except Exception:
                pass
            self._cdp_session = None
        if self._browser:
            try:
                self._browser.close()
            except Exception:
                pass
        if self._playwright:
            try:
                self._playwright.stop()
            except Exception:
                pass
        self._browser = None
        self._page = None
        self._playwright = None
        self._target_id_to_page = {}
        self._last_active_target_id = None
        self._cancel_idle_timer()

    def _update_activity(self) -> None:
        """更新最后活动时间，重置空闲定时器"""
        import time
        self._last_activity_time = time.time()
        self._cancel_idle_timer()
        self._start_idle_timer()

    def _start_idle_timer(self) -> None:
        """启动空闲定时器"""
        import threading
        def check_idle():
            import time
            if self._browser and self._last_activity_time > 0:
                idle_time = time.time() - self._last_activity_time
                if idle_time >= self.IDLE_TIMEOUT_SECONDS:
                    print(f"[browser] 空闲超时 ({self.IDLE_TIMEOUT_SECONDS}s)，自动关闭浏览器")
                    self.close()
                    return
            # 继续检查
            if self._browser:
                self._idle_timer = threading.Timer(60, check_idle)
                self._idle_timer.daemon = True
                self._idle_timer.start()

        self._idle_timer = threading.Timer(60, check_idle)
        self._idle_timer.daemon = True
        self._idle_timer.start()

    def _cancel_idle_timer(self) -> None:
        """取消空闲定时器"""
        if self._idle_timer:
            self._idle_timer.cancel()
            self._idle_timer = None

    def launch(self, headless: bool = True, channel: str = "", connect_existing: bool = True) -> dict[str, Any]:
        """Launch browser. Uses system Edge/Chrome by default (no download needed).

        Tries channels in order: msedge → chrome → chromium (bundled fallback).

        Args:
            headless: Run in headless mode
            channel: Browser channel ('chrome', 'msedge', or auto-detect)
            connect_existing: If True, try to connect to existing browser first (default True)
        """
        # Clean up any previous instance first
        self._cleanup_playwright()

        try:
            self._playwright = sync_playwright().start()

            # Step 0: Try to connect to existing browser or launch with debug port
            if connect_existing and not headless:
                # First, check if a debug port is already open (someone launched before)
                print("[browser] checking for existing debug port...", file=sys.stderr, flush=True)
                cdp_result = self._try_connect_existing()
                if cdp_result:
                    return cdp_result

                # No debug port available — try launching with real profile first.
                # _launch_with_debug_port checks if the profile is locked and
                # automatically falls back to a temp profile if it is.
                print("[browser] no debug port, trying real profile first...", file=sys.stderr, flush=True)
                launch_result = {"launched": False}
                for debug_browser in ("msedge", "chrome"):
                    launch_result = self._launch_with_debug_port(debug_browser, use_real_profile=True)
                    print(f"[browser] launch_result ({debug_browser}): {launch_result}", file=sys.stderr, flush=True)
                    if launch_result.get("launched"):
                        break

                if launch_result.get("launched"):
                    cdp_url = f"http://127.0.0.1:{launch_result.get('port', 9222)}"
                    connect_result = self.connect_cdp(cdp_url)
                    if connect_result.get("connected"):
                        connect_result["method"] = "launch_with_debug"
                        return connect_result

                print("[browser] all launch attempts failed, falling back to bundled chromium", file=sys.stderr, flush=True)

            # Step 1: Try system browsers (no download required, for headless or explicit launch)
            channels = [c for c in [channel, "msedge", "chrome", ""] if c is not None]
            if "" in channels:
                channels.remove("")
                channels.append("")  # bundled chromium as last resort

            # Auto-load extension if available
            ext_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'extension')
            # Base args to suppress first-run / privacy / cookie prompts
            base_args = [
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-default-apps",
                "--disable-component-update",
                "--disable-background-networking",
                "--disable-sync",
                "--disable-translate",
                "--metrics-recording-only",
                "--safebrowsing-disable-auto-update",
                "--enable-automation",
                "--suppress-message-center-popups",
                "--disable-features=PrivacySandboxSettings4,CookieConsent,TrackingProtectionUI",
                "--no-pings",
                "--disable-hang-monitor",
                "--disable-popup-blocking",
                "--disable-prompt-on-repost",
                "--disable-domain-reliability",
            ]
            ext_args = list(base_args)
            if os.path.isdir(ext_dir):
                ext_args.extend([f"--load-extension={ext_dir}", f"--disable-extensions-except={ext_dir}"])
                print(f"[browser] extension dir found: {ext_dir}", file=sys.stderr, flush=True)
            else:
                print(f"[browser] extension dir not found: {ext_dir}, skipping", file=sys.stderr, flush=True)

            last_error = ""
            for ch in channels:
                try:
                    launch_args: dict[str, Any] = {"headless": headless}
                    if ch:
                        launch_args["channel"] = ch
                    if ext_args:
                        launch_args["args"] = ext_args
                    print(f"[browser] trying channel: '{ch or 'bundled'}' ...", file=sys.stderr, flush=True)
                    self._browser = self._playwright.chromium.launch(**launch_args)
                    self._page = self._browser.new_page()
                    # Start tab monitoring
                    self._start_tab_monitoring()
                    result = {
                        "launched": True,
                        "headless": headless,
                        "channel": ch or "chromium",
                        "method": "launch",
                    }
                    print(f"[browser] ▶ launch success: {result}", file=sys.stderr, flush=True)
                    return result
                except Exception as e:
                    last_error = str(e)
                    print(f"[browser] channel '{ch or 'bundled'}' failed: {e}", file=sys.stderr, flush=True)
                    continue

            return {"launched": False, "error": f"All channels failed: {last_error}"}
        except Exception:
            return {"launched": False, "error": traceback.format_exc()}

    def _try_connect_existing(self) -> dict[str, Any] | None:
        """Try to connect to an existing browser via CDP.

        Checks common debug ports (9222, 9223, etc.) and returns result if successful.
        """
        import socket
        import json
        import urllib.request

        common_ports = [9222, 9223, 9229, 9333]

        for port in common_ports:
            # Check if port is open
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                    sock.settimeout(0.5)
                    if sock.connect_ex(("127.0.0.1", port)) != 0:
                        continue
            except Exception:
                continue

            # Verify it's a Chrome DevTools Protocol endpoint
            try:
                url = f"http://127.0.0.1:{port}/json/version"
                req = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(req, timeout=2) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    if "Browser" in data or "webSocketDebuggerUrl" in data:
                        print(f"[browser] found CDP at port {port}: {data.get('Browser', 'unknown')}", file=sys.stderr, flush=True)
                        # Try to connect
                        cdp_url = f"http://127.0.0.1:{port}"
                        result = self.connect_cdp(cdp_url)
                        if result.get("connected"):
                            return result
            except Exception:
                continue

        print("[browser] no existing browser found with debug port", file=sys.stderr, flush=True)
        return None

    def _launch_with_debug_port(self, browser: str = "msedge", port: int = 9222, use_real_profile: bool = False) -> dict[str, Any]:
        """Launch a browser with remote debugging port enabled.

        Args:
            browser: Browser to launch ('msedge' or 'chrome')
            port: Debug port number
            use_real_profile: If True, use the user's real browser profile (cookies,
                              logins, extensions). Only works when no other instance of
                              that browser is running. Falls back to temp profile if
                              the real profile is locked.

        Returns:
            dict with launch result
        """
        import subprocess
        import os
        import time
        import socket
        import tempfile

        def is_port_open(p: int) -> bool:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                    sock.settimeout(0.5)
                    return sock.connect_ex(("127.0.0.1", p)) == 0
            except Exception:
                return False

        # Check if debug port is already open
        if is_port_open(port):
            print(f"[browser] debug port {port} already open", file=sys.stderr, flush=True)
            return {"launched": True, "browser": browser, "port": port}

        # Find browser executable
        browser_paths = {
            "msedge": [
                os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
                os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            ],
            "chrome": [
                os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
                os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
                os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
            ],
        }

        exe_path = None
        for path in browser_paths.get(browser, []):
            if os.path.exists(path):
                exe_path = path
                break

        if not exe_path:
            return {"launched": False, "error": f"{browser} not found on this device"}

        # Determine which profile directory to use.
        # - Real profile: has user's cookies, Google login, bookmarks, etc.
        #   Only usable when no other instance of this browser is running
        #   (Chromium locks the profile directory).
        # - Temp profile: empty, but always works.
        real_profile = None
        profile_dir = "Default"
        if browser == "chrome":
            real_profile = os.path.expandvars(r"%LocalAppData%\Google\Chrome\User Data")
        elif browser == "msedge":
            real_profile = os.path.expandvars(r"%LocalAppData%\Microsoft\Edge\User Data")

        user_data_dir = None
        print(f"[browser] profile decision: use_real_profile={use_real_profile}, real_profile={real_profile}, exists={os.path.isdir(real_profile) if real_profile else 'N/A'}", file=sys.stderr, flush=True)
        if use_real_profile and real_profile and os.path.isdir(real_profile):
            # Check if profile is locked (another instance running)
            lock_file = os.path.join(real_profile, "lockfile")
            locked = False
            lock_exists = os.path.exists(lock_file)
            print(f"[browser] lockfile check: {lock_file}, exists={lock_exists}", file=sys.stderr, flush=True)
            try:
                # Try to rename the lock file — if it's held by another
                # process (the running browser), this will fail.
                test_name = lock_file + ".test"
                if lock_exists:
                    os.rename(lock_file, test_name)
                    os.rename(test_name, lock_file)
                print(f"[browser] lockfile rename test: OK (not locked)", file=sys.stderr, flush=True)
            except OSError as e:
                locked = True
                print(f"[browser] lockfile rename failed (locked): {e}", file=sys.stderr, flush=True)
            except Exception as e:
                locked = True
                print(f"[browser] lockfile rename failed (locked): {e}", file=sys.stderr, flush=True)

            if not locked:
                user_data_dir = real_profile
                print(f"[browser] using real profile: {real_profile}", file=sys.stderr, flush=True)
            else:
                print(f"[browser] real profile locked (lockfile={lock_file}), falling back to temp", file=sys.stderr, flush=True)

        if user_data_dir is None:
            user_data_dir = tempfile.mkdtemp(prefix="handy_debug_")
            profile_dir = None  # don't pass --profile-directory for temp dirs
            print(f"[browser] temp profile: {user_data_dir}", file=sys.stderr, flush=True)

        # Launch browser with debug port (+ auto-load extension)
        try:
            ext_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'extension')
            print(f"[browser] launching {browser} with --remote-debugging-port={port}", file=sys.stderr, flush=True)
            launch_args = [
                exe_path,
                f"--remote-debugging-port={port}",
                f"--user-data-dir={user_data_dir}",
                # ── Suppress first-run prompts ──
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-default-apps",
                "--disable-component-update",
                "--disable-background-networking",
                "--disable-sync",
                "--disable-translate",
                "--metrics-recording-only",
                "--safebrowsing-disable-auto-update",
                # ── Suppress extension / automation warnings ──
                "--enable-automation",
                "--suppress-message-center-popups",
                "--disable-extensions-http-throttling",
                # ── Suppress cookie / privacy / tracking prompts ──
                "--disable-features=PrivacySandboxSettings4,CookieConsent,TrackingProtectionUI",
                "--no-pings",
                "--disable-hang-monitor",
                "--disable-popup-blocking",
                "--disable-prompt-on-repost",
                "--disable-domain-reliability",
                "--disable-component-extensions-with-background-pages",
            ]
            if profile_dir:
                launch_args.append(f"--profile-directory={profile_dir}")
            if os.path.isdir(ext_dir):
                launch_args.append(f"--load-extension={ext_dir}")
                launch_args.append(f"--disable-extensions-except={ext_dir}")
                print(f"[browser] loading extension from {ext_dir}", file=sys.stderr, flush=True)
            proc = subprocess.Popen(launch_args)

            # Poll for port ready (wait up to 5 seconds)
            for i in range(25):
                time.sleep(0.2)

                if is_port_open(port):
                    print(f"[browser] debug port {port} ready after {(i+1)*0.2:.1f}s", file=sys.stderr, flush=True)
                    return {"launched": True, "browser": browser, "port": port, "user_data_dir": user_data_dir, "real_profile": user_data_dir == real_profile}

                # If the process died early, something is wrong
                if proc.poll() is not None:
                    if is_port_open(port):
                        return {"launched": True, "browser": browser, "port": port, "user_data_dir": user_data_dir, "real_profile": user_data_dir == real_profile}
                    return {"launched": False, "error": f"{browser} exited with code {proc.returncode}"}

            # Timeout
            return {"launched": False, "error": f"Debug port {port} not ready after 5s"}
        except Exception as e:
            return {"launched": False, "error": str(e)}

    def connect_cdp(self, cdp_url: str) -> dict[str, Any]:
        """Connect to an existing browser via Chrome DevTools Protocol."""
        try:
            print(f"[browser] connecting to CDP: {cdp_url}", file=sys.stderr, flush=True)
            if self._playwright is None:
                self._playwright = sync_playwright().start()
            self._browser = self._playwright.chromium.connect_over_cdp(cdp_url)
            print(f"[browser] CDP connected, browser contexts: {len(self._browser.contexts)}", file=sys.stderr, flush=True)
            contexts = self._browser.contexts
            if contexts and contexts[0].pages:
                self._page = contexts[0].pages[0]
                print(f"[browser] using existing page: {self._page.url}", file=sys.stderr, flush=True)
            else:
                if not contexts:
                    context = self._browser.new_context()
                    self._page = context.new_page()
                    print(f"[browser] created new context and page", file=sys.stderr, flush=True)
                else:
                    self._page = contexts[0].new_page()
                    print(f"[browser] created new page in existing context", file=sys.stderr, flush=True)

            # Verify self._page is set
            if self._page is None:
                print(f"[browser] ERROR: self._page is None after connect_cdp!", file=sys.stderr, flush=True)
                return {"connected": False, "launched": False, "error": "Failed to get page"}

            # Start tab monitoring
            self._start_tab_monitoring()

            result = {
                "connected": True,
                "launched": True,
                "cdp_url": cdp_url,
                "url": self._page.url,
                "title": self._page.title(),
                "channel": "cdp",
                "method": "connect_cdp",
            }
            print(f"[browser] CDP connect success: {result}", file=sys.stderr, flush=True)
            return result
        except Exception as e:
            print(f"[browser] CDP connect failed: {e}", file=sys.stderr, flush=True)
            return {"connected": False, "launched": False, "error": str(e)}

    def _start_tab_monitoring(self) -> None:
        """Start monitoring tab changes via CDP events."""
        if not self._browser:
            return

        try:
            # Create a browser-level CDP session
            self._cdp_session = self._browser.new_browser_cdp_session()

            # Build initial target -> page mapping
            self._rebuild_target_mapping()

            # Listen for target attached (new tab opened or switched to)
            def on_target_created(event: dict) -> None:
                target_info = event.get("targetInfo", {})
                target_id = target_info.get("targetId")
                target_type = target_info.get("type")
                if target_type == "page" and target_id:
                    self._last_active_target_id = target_id
                    print(f"[browser] target_created: targetId={target_id}, url={target_info.get('url', '')}", file=sys.stderr, flush=True)
                    self._rebuild_target_mapping()

            def on_target_destroyed(event: dict) -> None:
                target_id = event.get("targetId")
                if target_id and target_id in self._target_id_to_page:
                    del self._target_id_to_page[target_id]
                    print(f"[browser] target_destroyed: targetId={target_id}", file=sys.stderr, flush=True)

            def on_target_info_changed(event: dict) -> None:
                target_info = event.get("targetInfo", {})
                target_id = target_info.get("targetId")
                target_type = target_info.get("type")
                url = target_info.get("url", "")
                if target_type == "page" and target_id:
                    self._last_active_target_id = target_id
                    print(f"[browser] target_info_changed: targetId={target_id}, url={url}", file=sys.stderr, flush=True)

            self._cdp_session.on("Target.targetCreated", on_target_created)
            self._cdp_session.on("Target.targetDestroyed", on_target_destroyed)
            self._cdp_session.on("Target.targetInfoChanged", on_target_info_changed)

            # Enable target discovery
            self._cdp_session.send("Target.setDiscoverTargets", {"discover": True})

            print("[browser] tab monitoring started", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[browser] tab monitoring failed: {e}", file=sys.stderr, flush=True)

    def _rebuild_target_mapping(self) -> None:
        """Rebuild target ID to Page mapping."""
        if not self._browser:
            return

        self._target_id_to_page = {}
        try:
            # Get all targets via CDP
            targets = self._cdp_session.send("Target.getTargets")
            page_targets = [t for t in targets.get("targetInfos", []) if t.get("type") == "page"]
            print(f"[browser] _rebuild_target_mapping: found {len(page_targets)} page targets", file=sys.stderr, flush=True)

            # Map target IDs to Playwright pages
            for target in page_targets:
                target_id = target.get("targetId")
                target_url = target.get("url", "")

                # Find matching Playwright page
                for ctx in self._browser.contexts:
                    for page in ctx.pages:
                        # Match by URL (not perfect but works for most cases)
                        if page.url == target_url:
                            self._target_id_to_page[target_id] = page
                            print(f"[browser] mapped target {target_id} -> page {target_url}", file=sys.stderr, flush=True)
                            break

            print(f"[browser] target mapping: {len(self._target_id_to_page)} entries", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[browser] rebuild mapping failed: {e}", file=sys.stderr, flush=True)

    def _get_active_page(self) -> Page | None:
        """Get the currently active page via CDP."""
        if not self._cdp_session or not self._browser:
            return None
        try:
            # Get all targets
            targets = self._cdp_session.send("Target.getTargets")
            page_targets = [t for t in targets.get("targetInfos", []) if t.get("type") == "page"]
            # Find the one that is focused/active
            for target in page_targets:
                if target.get("attached"):
                    target_id = target.get("targetId")
                    # Find matching Playwright page
                    for ctx in self._browser.contexts:
                        for page in ctx.pages:
                            if not page.is_closed():
                                return page
        except Exception as e:
            print(f"[browser] _get_active_page failed: {e}", file=sys.stderr, flush=True)
        return None

    def _sync_active_page(self) -> None:
        """Sync to the user's currently active tab."""
        print(f"[browser] _sync_active_page: last_active_target_id={self._last_active_target_id}, current_page={self._page.url if self._page else 'None'}", file=sys.stderr, flush=True)

        # Try to find the page for tracked target ID
        if self._last_active_target_id:
            page = self._target_id_to_page.get(self._last_active_target_id)
            if page and not page.is_closed():
                old_url = self._page.url if self._page else "None"
                self._page = page
                print(f"[browser] synced to tracked tab: {old_url} -> {page.url}", file=sys.stderr, flush=True)
                return

        # Fallback: use first available page from browser contexts
        if self._browser:
            for ctx in self._browser.contexts:
                for page in ctx.pages:
                    if not page.is_closed():
                        old_url = self._page.url if self._page else "None"
                        self._page = page
                        print(f"[browser] synced to first available page: {old_url} -> {page.url}", file=sys.stderr, flush=True)
                        return

    def navigate(self, url: str = "", action: str = "goto") -> dict[str, Any]:
        """Navigate the browser. action: "goto", "back", "forward"."""
        print(f"[browser] navigate called: url={url}, action={action}, self._page={self._page}", file=sys.stderr, flush=True)
        if not self._page:
            print(f"[browser] ERROR: self._page is None!", file=sys.stderr, flush=True)
            return {"navigated": False, "error": "Browser not launched. Call web_launch first."}
        self._sync_active_page()
        self._update_activity()  # 更新活动时间
        try:
            if action == "back":
                self._page.go_back(wait_until="domcontentloaded", timeout=15000)
            elif action == "forward":
                self._page.go_forward(wait_until="domcontentloaded", timeout=15000)
            else:
                if not url:
                    return {"navigated": False, "error": "url is required for action 'goto'"}
                self._page.goto(url, wait_until="domcontentloaded", timeout=30000)
            result = {"url": self._page.url, "title": self._page.title()}
            print(f"[browser] ▶ navigate({action}, {url}): {result}", file=sys.stderr, flush=True)
            return result
        except Exception:
            return {"navigated": False, "error": traceback.format_exc()}

    def get_interactive_nodes(self) -> dict[str, Any]:
        """Return visible interactive DOM elements + accessibility tree snapshot."""
        if not self._page:
            return {"url": "", "title": "", "nodes": [], "count": 0, "error": "Browser not launched"}

        self._sync_active_page()
        print(f"[browser] get_interactive: page_url={self._page.url}, page_title={self._page.title()}", file=sys.stderr, flush=True)
        try:
            dom = self._page.evaluate("""() => {
                const selector = 'a,button,input,select,textarea,[role="button"],[role="link"],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="listitem"],[role="treeitem"],[contenteditable="true"]';
                return Array.from(document.querySelectorAll(selector))
                    .filter(el => {
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0
                            && r.top >= 0 && r.left >= 0
                            && r.bottom <= window.innerHeight
                            && r.right <= window.innerWidth;
                    })
                    .map((el, i) => ({
                        index: i,
                        tag: el.tagName.toLowerCase(),
                        role: el.getAttribute('role') || '',
                        name: (el.getAttribute('aria-label')
                            || el.getAttribute('title')
                            || el.getAttribute('placeholder')
                            || (el.textContent || '').trim().substring(0, 80)),
                        selector: el.id ? '#' + CSS.escape(el.id)
                            : '',
                        text: (el.textContent || '').trim().substring(0, 120),
                        bounds: (() => {
                            const r = el.getBoundingClientRect();
                            return {left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height)};
                        })(),
                    }));
            }""")

            # Also get accessibility tree for roles/names
            accessibility = None
            try:
                snapshot = self._page.accessibility.snapshot()
                accessibility = snapshot
            except Exception:
                pass

            return {
                "url": self._page.url,
                "title": self._page.title(),
                "nodes": dom,
                "accessibility": accessibility,
                "count": len(dom) if dom else 0,
            }
        except Exception:
            return {"url": "", "title": "", "nodes": [], "count": 0, "error": traceback.format_exc()}

    def _get_all_pages(self) -> list:
        """Get all open pages across all browser contexts."""
        pages = []
        if self._browser:
            for ctx in self._browser.contexts:
                pages.extend(ctx.pages)
        return pages

    def _check_new_tab(self, pages_before: list) -> None:
        """Check if a new tab was opened and switch to it."""
        pages_after = self._get_all_pages()
        if len(pages_after) > len(pages_before):
            new_page = pages_after[-1]
            self._page = new_page
            print(f"[browser] new tab detected, switched to: {new_page.url}", file=sys.stderr, flush=True)
            # Update target mapping
            self._rebuild_target_mapping()

    def click_selector(self, selector: str) -> dict[str, Any]:
        """Click an element by CSS selector."""
        if not self._page:
            return {"clicked": False, "error": "Browser not launched"}
        self._sync_active_page()
        self._update_activity()  # 更新活动时间
        print(f"[browser] click_selector: selector={selector}, page_url={self._page.url}", file=sys.stderr, flush=True)
        pages_before = self._get_all_pages()
        try:
            self._page.click(selector, timeout=5000)
            self._check_new_tab(pages_before)
            return {"clicked": True, "selector": selector, "page_url": self._page.url}
        except Exception:
            return {"clicked": False, "error": traceback.format_exc()}

    def click_role(self, role: str, name: str | None = None) -> dict[str, Any]:
        """Click an element by ARIA role and optional accessible name."""
        if not self._page:
            return {"clicked": False, "error": "Browser not launched"}
        self._sync_active_page()
        self._update_activity()  # 更新活动时间
        pages_before = self._get_all_pages()
        try:
            locator = self._page.get_by_role(role, name=name) if name else self._page.get_by_role(role)
            locator.first.click(timeout=5000)
            self._check_new_tab(pages_before)
            return {"clicked": True, "role": role, "name": name or "", "page_url": self._page.url}
        except Exception:
            return {"clicked": False, "error": traceback.format_exc()}

    def fill(self, selector: str, text: str) -> dict[str, Any]:
        """Fill an input field by CSS selector."""
        if not self._page:
            return {"filled": False, "error": "Browser not launched"}
        self._sync_active_page()
        self._update_activity()  # 更新活动时间
        print(f"[browser] fill: selector={selector}, page_url={self._page.url}", file=sys.stderr, flush=True)
        try:
            self._page.fill(selector, text, timeout=5000)
            return {"filled": True, "selector": selector, "text": text}
        except Exception:
            return {"filled": False, "error": traceback.format_exc()}

    def type_text(self, text: str) -> dict[str, Any]:
        """Type text at the current focus."""
        if not self._page:
            return {"typed": False, "error": "Browser not launched"}
        self._sync_active_page()
        try:
            self._page.keyboard.type(text)
            return {"typed": text}
        except Exception:
            return {"typed": False, "error": traceback.format_exc()}

    def scroll(self, delta_y: int = 300) -> dict[str, Any]:
        """Scroll the page by delta_y pixels."""
        if not self._page:
            return {"scrolled": False, "error": "Browser not launched"}
        self._sync_active_page()
        try:
            self._page.evaluate(f"window.scrollBy(0, {delta_y})")
            return {"scrolled": True, "delta_y": delta_y}
        except Exception:
            return {"scrolled": False, "error": traceback.format_exc()}

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

    def close(self) -> dict[str, Any]:
        """Close browser and clean up.

        If the browser was launched via ``launch()``, this will terminate the
        browser process.  If it was connected via CDP (``connect_cdp``), we
        only disconnect — the external browser keeps running.
        """
        try:
            self._recording_active = False
            self._cleanup_playwright()
            return {"closed": True}
        except Exception:
            return {"closed": False, "error": traceback.format_exc()}

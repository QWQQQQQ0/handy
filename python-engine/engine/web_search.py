"""Web search via DuckDuckGo + page content fetch (Playwright with stealth).

fetch strategy (tried in order):
  1. Playwright Chromium with stealth patches → inner_text
  2. Playwright content() HTML + strip → text
  3. httpx HTTP request + regex strip → text
"""

from __future__ import annotations

import re
import sys
import time
from html import unescape
from typing import Any


class WebSearchEngine:
    """DuckDuckGo search + url content fetch."""

    # ── Search ──

    def search(self, query: str, max_results: int = 10) -> dict[str, Any]:
        """Search DuckDuckGo and return title/url/snippet results."""
        try:
            from ddgs import DDGS
        except ImportError:
            return {
                "success": False,
                "error": "ddgs not installed. Run: pip install ddgs",
            }

        try:
            with DDGS() as ddgs:
                results = list(ddgs.text(query, max_results=max_results))
            return {
                "success": True,
                "query": query,
                "results": [
                    {"title": r["title"], "url": r["href"], "snippet": r["body"]}
                    for r in results
                ],
                "count": len(results),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ── Fetch (Playwright-first, httpx fallback) ──

    def fetch(self, url: str, timeout: int = 30) -> dict[str, Any]:
        """Fetch a URL and return its full text content.

        Tries Playwright first (full JS rendering + stealth), then
        falls back to httpx (fast, works on static / non-blocking sites).
        """
        # Strategy 1: Playwright with stealth
        result = self._fetch_with_playwright(url, timeout)
        if result is not None:
            return result

        # Strategy 2: httpx
        return self._fetch_with_httpx(url, timeout)

    # ─────────────────────────────────────────────────────────────
    # Playwright fetch
    # ─────────────────────────────────────────────────────────────

    @staticmethod
    def _log(msg: str) -> None:
        """Log to stderr so it shows up in the Python engine output."""
        ts = time.strftime("%H:%M:%S")
        print(f"[web_fetch {ts}] {msg}", file=sys.stderr, flush=True)

    @staticmethod
    def _text_preview(text: str, max_len: int = 200) -> str:
        """Return a preview of text for logging."""
        if not text:
            return "(empty)"
        preview = text[:max_len].replace("\n", "\\n").replace("\r", "")
        suffix = f"...({len(text)} chars total)" if len(text) > max_len else f"({len(text)} chars)"
        return f"{preview}{suffix}"

    _STEALTH_JS = """
// Hide automation fingerprints that sites like Bing / Cloudflare check
Object.defineProperty(navigator, 'webdriver', { get: () => false });
Object.defineProperty(navigator, 'plugins', {
    get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ],
});
Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
window.chrome = { runtime: {} };
// Override permissions.query to avoid detection
const origQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(parameters)
);
"""

    def _fetch_with_playwright(self, url: str, timeout: int) -> dict[str, Any] | None:
        try:
            from playwright.sync_api import sync_playwright, TimeoutError as PwTimeout
        except ImportError:
            self._log("ERROR: playwright not installed")
            return None

        t0 = time.time()
        self._log(f"START url={url} timeout={timeout}s")

        try:
            with sync_playwright() as pw:
                # Launch browser — try system Chrome/Edge first (no download
                # required), fall back to bundled chromium only as last resort.
                # This mirrors the fallback chain in browser.py.
                browser = None
                launch_error = None
                for channel in ("chrome", "msedge", None):
                    try:
                        kwargs: dict = dict(
                            headless=True,
                            args=[
                                "--no-sandbox",
                                "--disable-setuid-sandbox",
                                "--disable-blink-features=AutomationControlled",
                                "--disable-features=IsolateOrigins,site-per-process,TranslateUI",
                                "--disable-infobars",
                                "--window-size=1920,1080",
                            ],
                        )
                        if channel is not None:
                            kwargs["channel"] = channel
                        browser = pw.chromium.launch(**kwargs)
                        self._log(f"Browser launched: channel={channel or 'bundled'}")
                        break
                    except Exception as e:
                        launch_error = e
                        self._log(f"Browser launch failed for channel={channel or 'bundled'}: {e}")
                        continue

                if browser is None:
                    self._log(f"All browser channels exhausted. Last error: {launch_error}")
                    return None
                context = browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/131.0.0.0 Safari/537.36"
                    ),
                    viewport={"width": 1920, "height": 1080},
                    locale="zh-CN",
                    timezone_id="Asia/Shanghai",
                    permissions=["geolocation"],
                    geolocation={"latitude": 30.5, "longitude": 120.4},
                )
                page = context.new_page()
                page.add_init_script(WebSearchEngine._STEALTH_JS)

                text = ""
                try:
                    # Block only heavy resources — keep stylesheets for proper rendering
                    page.route(
                        "**/*",
                        lambda route: (
                            route.abort()
                            if route.request.resource_type in {"image", "font", "media", "websocket"}
                            else route.continue_()
                        ),
                    )

                    # ═══════════════════════════════════════════════════════
                    # Phase 1: Navigate — wait for "load"
                    # ═══════════════════════════════════════════════════════
                    t1 = time.time()
                    page.goto(url, timeout=timeout * 1000, wait_until="load")
                    self._log(f"Phase1 goto-load OK ({time.time() - t1:.1f}s)")

                    # Phase 1.5: peek at what we have right after load
                    try:
                        early = page.inner_text()
                        self._log(f"Phase1 after-load body text: {self._text_preview(early)}")
                    except Exception:
                        self._log("Phase1 after-load body text: (error reading)")

                    # ═══════════════════════════════════════════════════════
                    # Phase 2: Wait for network to settle
                    # ═══════════════════════════════════════════════════════
                    t2 = time.time()
                    idle_timeout = max(timeout * 1000, 12000)  # ≥ 12 s
                    try:
                        page.wait_for_load_state("networkidle", timeout=idle_timeout)
                        self._log(f"Phase2 networkidle OK ({time.time() - t2:.1f}s)")
                    except PwTimeout:
                        self._log(f"Phase2 networkidle TIMEOUT after {time.time() - t2:.1f}s — proceeding anyway")

                    # Phase 2.5: peek again
                    try:
                        after_idle = page.inner_text()
                        self._log(f"Phase2 after-idle body text: {self._text_preview(after_idle)}")
                    except Exception:
                        self._log("Phase2 after-idle body text: (error reading)")

                    # ═══════════════════════════════════════════════════════
                    # Phase 3: Wait for meaningful content to appear
                    # ═══════════════════════════════════════════════════════
                    t3 = time.time()
                    try:
                        page.wait_for_function(
                            """() => {
                                const bodyText = (document.body?.innerText || '').replace(/\\s/g, '');
                                if (bodyText.length > 100) return true;
                                for (const sel of ['#root', '#app', '#__next', '#__nuxt', '[data-reactroot]', 'main']) {
                                    const el = document.querySelector(sel);
                                    if (el && (el.innerText || '').replace(/\\s/g, '').length > 50) return true;
                                }
                                return false;
                            }""",
                            timeout=12000,
                        )
                        self._log(f"Phase3 meaningful-content OK ({time.time() - t3:.1f}s)")
                    except PwTimeout:
                        self._log(f"Phase3 meaningful-content TIMEOUT after {time.time() - t3:.1f}s — may be empty page")

                    # Peek
                    try:
                        after_content = page.inner_text()
                        self._log(f"Phase3 after-wait body text: {self._text_preview(after_content)}")
                    except Exception:
                        self._log("Phase3 after-wait body text: (error reading)")

                    # ═══════════════════════════════════════════════════════
                    # Phase 4: Content stability check
                    # ═══════════════════════════════════════════════════════
                    t4 = time.time()
                    prev_text = ""
                    stab_rounds = 0
                    for _attempt in range(8):
                        try:
                            current = page.inner_text()
                        except Exception:
                            break
                        if prev_text and len(current) > 200:
                            max_len = max(len(current), len(prev_text))
                            diff = abs(len(current) - len(prev_text))
                            if max_len > 0 and diff / max_len < 0.05:
                                stab_rounds = _attempt + 1
                                break  # content has stabilised
                        prev_text = current
                        page.wait_for_timeout(1500)
                    if stab_rounds:
                        self._log(f"Phase4 content stable after {stab_rounds} rounds ({time.time() - t4:.1f}s)")
                    else:
                        self._log(f"Phase4 stability check exhausted (8 rounds, {time.time() - t4:.1f}s) — content may still be changing")

                    # ═══════════════════════════════════════════════════════
                    # Phase 5: Scroll to trigger lazy-loaded content
                    # ═══════════════════════════════════════════════════════
                    t5 = time.time()
                    page_height = page.evaluate("document.body.scrollHeight")
                    self._log(f"Phase5 page_height={page_height}")
                    if page_height > 1500:
                        steps = min(page_height // 600, 6)
                        for i in range(1, steps + 1):
                            page.evaluate(
                                f"window.scrollTo(0, {i * page_height // (steps + 1)})"
                            )
                            page.wait_for_timeout(1200)
                        self._log(f"Phase5 scrolled {steps} steps ({time.time() - t5:.1f}s)")
                    else:
                        self._log(f"Phase5 scroll SKIPPED (page too short)")
                    # Scroll back to top so extraction sees the full DOM
                    page.evaluate("window.scrollTo(0, 0)")
                    page.wait_for_timeout(800)

                    # ═══════════════════════════════════════════════════════
                    # Phase 6: Final settle
                    # ═══════════════════════════════════════════════════════
                    page.wait_for_timeout(1000)

                    # Final pre-extraction peek
                    try:
                        final_peek = page.inner_text()
                        self._log(f"Phase6 pre-extract body text: {self._text_preview(final_peek)}")
                    except Exception:
                        self._log("Phase6 pre-extract body text: (error reading)")

                    # ── 4 extraction strategies, prefer main content ──

                    candidates: list[tuple[str, int]] = []  # (text, priority)

                    # Strategy 0: Find main content container (highest priority)
                    try:
                        main_result = page.evaluate("""() => {
                            const SELECTORS = [
                                'main', 'article', '[role="main"]',
                                '.markdown-body', '.doc-content', '.article-content',
                                '.content-main', '.page-content', '.post-content',
                                '.documentation', '.docs-content',
                                '#content', '#main-content', '#article',
                                '.theme-default-content',
                                '.md-content',
                                '.prose', '.post-body', '.entry-content',
                                '[class*="article"]', '[class*="doc"]',
                                '.detail-content', '.detail-body',
                            ];
                            let best = null;
                            let bestScore = 0;
                            for (const sel of SELECTORS) {
                                const el = document.querySelector(sel);
                                if (!el) continue;
                                const text = el.innerText || el.textContent || '';
                                const len = text.length;
                                if (len < 200) continue;
                                const noiseCount = (text.match(/\\b(首页|文档|API|价格|联系|登录|注册|更新日志|常见问题|服务协议|隐私|条款|导航|菜单|搜索|主页|关于|版权|备案|ICP|copyright|privacy|terms|login|sign|register|menu|nav|sidebar|footer)\\b/gi) || []).length;
                                const score = len - (noiseCount * 200);
                                if (score > bestScore) {
                                    bestScore = score;
                                    best = { selector: sel, text, length: len };
                                }
                            }
                            return best;
                        }""")
                        if main_result and main_result.get("text"):
                            t = main_result["text"].strip()
                            sel = main_result.get("selector", "?")
                            self._log(f"Strategy0: found container [{sel}] len={len(t)}")
                            if len(t) > 200:
                                candidates.append((t, 10))
                        else:
                            self._log("Strategy0: no matching content container found")
                    except Exception as e:
                        self._log(f"Strategy0 ERROR: {e}")

                    # Strategy A: inner_text (full page)
                    try:
                        t = page.inner_text()
                        if t and len(t.strip()) > 0:
                            self._log(f"StrategyA: inner_text len={len(t.strip())}")
                            candidates.append((t.strip(), 1))
                        else:
                            self._log("StrategyA: inner_text empty")
                    except Exception as e:
                        self._log(f"StrategyA ERROR: {e}")

                    # Strategy B: TreeWalker all visible text nodes
                    try:
                        t = page.evaluate("""() => {
                            const body = document.body;
                            if (!body) return '';
                            const walker = document.createTreeWalker(
                                body, NodeFilter.SHOW_TEXT, null
                            );
                            const parts = [];
                            let n;
                            while (n = walker.nextNode()) {
                                const p = n.parentElement;
                                if (!p) continue;
                                const style = window.getComputedStyle(p);
                                if (style.display === 'none' || style.visibility === 'hidden') continue;
                                const tag = p.tagName.toLowerCase();
                                if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;
                                const t = n.textContent;
                                if (t) parts.push(t.trim());
                            }
                            return parts.join('\\n');
                        }""")
                        if t and len(t.strip()) > 0:
                            self._log(f"StrategyB: TreeWalker len={len(t.strip())}")
                            candidates.append((t.strip(), 0))
                        else:
                            self._log("StrategyB: TreeWalker empty")
                    except Exception as e:
                        self._log(f"StrategyB ERROR: {e}")

                    # Strategy C: page.content() → strip HTML
                    try:
                        html = page.content()
                        t = _html_to_text(html)
                        if t and len(t.strip()) > 0:
                            self._log(f"StrategyC: content() HTML→text len={len(t.strip())}")
                            candidates.append((t.strip(), -1))
                        else:
                            self._log("StrategyC: content() HTML→text empty")
                    except Exception as e:
                        self._log(f"StrategyC ERROR: {e}")

                    # Pick best: highest priority, then longest
                    candidates.sort(key=lambda x: (x[1], len(x[0])), reverse=True)
                    if candidates:
                        chosen_priority = candidates[0][1]
                        self._log(f"Extraction: chose priority={chosen_priority} ({len(candidates)} candidates, priorities: {[(c[1], len(c[0])) for c in candidates]})")
                        text = candidates[0][0]
                    else:
                        self._log("Extraction: ALL strategies returned empty — no text captured!")
                        text = ""

                except PwTimeout:
                    self._log(f"Phase1 goto TIMEOUT after {timeout}s — grabbing whatever rendered")
                    # Timed out — grab whatever we have
                    try:
                        text = page.inner_text() or _html_to_text(page.content())
                    except Exception:
                        text = ""
                finally:
                    context.close()
                    browser.close()

                max_len = 50000
                truncated = len(text) > max_len
                text = text[:max_len].strip()

                self._log(f"RESULT: len={len(text)} truncated={truncated} total_time={time.time() - t0:.1f}s")
                self._log(f"RESULT preview: {self._text_preview(text)}")

                if len(text) < 30:
                    self._log("RESULT: too short (<30 chars), falling back to httpx")
                    return None  # too short — let httpx try

                return {
                    "success": True,
                    "url": url,
                    "method": "playwright",
                    "content": text,
                    "content_length": len(text),
                    "truncated": truncated,
                }

        except Exception as e:
            self._log(f"FATAL: {type(e).__name__}: {e}")
            import traceback
            self._log(traceback.format_exc())
            return None

    # ─────────────────────────────────────────────────────────────
    # httpx fallback
    # ─────────────────────────────────────────────────────────────

    def _fetch_with_httpx(self, url: str, timeout: int) -> dict[str, Any]:
        try:
            import httpx
        except ImportError:
            return {
                "success": False,
                "error": "httpx not installed. Run: pip install httpx",
            }

        try:
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            }
            response = httpx.get(
                url,
                headers=headers,
                timeout=timeout,
                follow_redirects=True,
            )
            response.raise_for_status()

            raw_html = response.text
            max_len = 50000
            truncated = len(raw_html) > max_len
            text = _html_to_text(raw_html[:max_len])

            return {
                "success": True,
                "url": str(response.url),
                "method": "httpx",
                "content": text,
                "content_length": len(text),
                "truncated": truncated,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────
# HTML → text
# ─────────────────────────────────────────────────────────────────

_BLOCK_RE = re.compile(
    r"</?(?:div|p|h[1-6]|li|tr|br|article|section|header|footer|main|nav|pre|table|ul|ol|dl|blockquote|details|summary|figure|figcaption|aside|form|fieldset)[^>]*>",
    re.IGNORECASE,
)
# Inline elements whose tags should be replaced with a space
# so that words don't run together.  e.g. <span>A</span><span>B</span> → "A B"
_INLINE_TAG_RE = re.compile(
    r"</?(?:span|a|strong|b|em|i|code|label|small|sub|sup|mark|cite|time|abbr|kbd|samp|var|dfn)[^>]*>",
    re.IGNORECASE,
)
_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_STYLE_RE = re.compile(
    r"<(script|style|noscript|iframe|svg)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE
)
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_WS_RE = re.compile(r"[ \t]+")
_NL_RE = re.compile(r"\n\s*\n")


def _html_to_text(html: str) -> str:
    text = _COMMENT_RE.sub("", html)
    text = _SCRIPT_STYLE_RE.sub("", text)
    text = _BLOCK_RE.sub("\n", text)          # block → newline
    text = _INLINE_TAG_RE.sub(" ", text)      # inline → space (prevents word-merge)
    text = _TAG_RE.sub("", text)              # strip remaining tags
    text = unescape(text)
    text = _NL_RE.sub("\n\n", text)
    text = _WS_RE.sub(" ", text)
    return text.strip()

// Stealth content script — runs at document_start in every frame.
// 1. Masks Playwright/automation fingerprints so anti-bot systems see a normal browser.
// 2. Captures user interactions (click, input, copy, paste) and reports to background.

(() => {
  // ── Anti-detection ──

  // 1. navigator.webdriver = false (the #1 detection vector)
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
    configurable: true,
  });

  // 2. Ensure chrome runtime looks normal
  if (!window.chrome) {
    window.chrome = { runtime: {} };
  }

  // 3. Fix plugins length (headless has 0 plugins)
  if (navigator.plugins.length === 0) {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5], // non-empty array
      configurable: true,
    });
  }

  // 4. Fix languages (headless may be empty)
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      configurable: true,
    });
  }

  // 5. Mask HeadlessChrome in user-agent (only affects old detection)
  const ua = navigator.userAgent;
  if (ua.includes('HeadlessChrome')) {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => ua.replace('HeadlessChrome', 'Chrome'),
      configurable: true,
    });
  }

  // ── Event capture (controlled by background script) ──

  let _captureEnabled = false;
  // Physical screen size from backend (for coordinate correction)
  let _physicalScreen = { width: 0, height: 0 };

  // Listen for enable/disable commands from background (消息通道)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'set_capture_enabled') {
      _captureEnabled = msg.enabled;
    }
    if (msg.type === 'screen_info' && msg.data) {
      _physicalScreen.width = msg.data.width || 0;
      _physicalScreen.height = msg.data.height || 0;
    }
  });

  // 同时检查页面全局标记（background 通过 executeScript 设置）
  // 定期同步，因为 executeScript 设置的是页面上下文的变量
  setInterval(() => {
    if (typeof window.__openpaw_capture_enabled !== 'undefined') {
      _captureEnabled = !!window.__openpaw_capture_enabled;
    }
  }, 1000);

  /** Build a CSS selector for the element */
  function buildSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const cls = current.className.trim().split(/\s+/).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
        if (cls) selector += cls;
      }
      // Add nth-child if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector += `:nth-child(${idx})`;
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  /** Extract semantic info from an element */
  function extractElementInfo(el) {
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      name: (el.getAttribute('aria-label')
        || el.getAttribute('title')
        || el.getAttribute('placeholder')
        || (el.textContent || '').trim().substring(0, 80)),
      selector: buildSelector(el),
      text: (el.textContent || '').trim().substring(0, 120),
      href: el.getAttribute('href') || '',
      bounds: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  /** Report an event to the background script */
  let _contextValid = true;
  function reportEvent(eventData) {
    if (!_captureEnabled || !_contextValid) return;
    try {
      chrome.runtime.sendMessage({ type: 'user_event', data: eventData }, () => {
        if (chrome.runtime.lastError) {
          // Extension context invalidated — 停止捕获，等页面刷新后重新注入
          if (chrome.runtime.lastError.message.includes(' invalidated')) {
            _captureEnabled = false;
            _contextValid = false;
          }
        }
      });
    } catch (e) {
      // Extension context invalidated — 停止捕获
      _captureEnabled = false;
      _contextValid = false;
    }
  }

  /** 获取视口信息 */
  function getViewportInfo() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    };
  }

  // ── Mouse down capture (raw event, classification in collector) ──
  document.addEventListener('mousedown', (e) => {
    reportEvent({
      type: 'mousedown',
      button: e.button,  // 0=left, 1=middle, 2=right
      x: e.clientX,
      y: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
      screenWidth: screen.width,
      screenHeight: screen.height,
      physicalWidth: _physicalScreen.width,
      physicalHeight: _physicalScreen.height,
      element: extractElementInfo(e.target),
      url: location.href,
      title: document.title,
      timestamp: Date.now(),
      viewport: getViewportInfo(),
    });
  }, true);

  // ── Mouse up capture (raw event, classification in collector) ──
  document.addEventListener('mouseup', (e) => {
    reportEvent({
      type: 'mouseup',
      button: e.button,  // 0=left, 1=middle, 2=right
      x: e.clientX,
      y: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
      screenWidth: screen.width,
      screenHeight: screen.height,
      physicalWidth: _physicalScreen.width,
      physicalHeight: _physicalScreen.height,
      element: extractElementInfo(e.target),
      url: location.href,
      title: document.title,
      timestamp: Date.now(),
      viewport: getViewportInfo(),
    });
  }, true);

  // ── Context menu (right click) ──
  document.addEventListener('contextmenu', (e) => {
    reportEvent({
      type: 'contextmenu',
      x: e.clientX,
      y: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
      screenWidth: screen.width,
      screenHeight: screen.height,
      physicalWidth: _physicalScreen.width,
      physicalHeight: _physicalScreen.height,
      element: extractElementInfo(e.target),
      url: location.href,
      title: document.title,
      timestamp: Date.now(),
      viewport: getViewportInfo(),
    });
  }, true);

  // ── Input capture ──
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) {
      reportEvent({
        type: 'input',
        value: (el.value || el.textContent || '').substring(0, 200),
        screenX: e.screenX,
        screenY: e.screenY,
        screenWidth: screen.width,
        screenHeight: screen.height,
        physicalWidth: _physicalScreen.width,
        physicalHeight: _physicalScreen.height,
        element: extractElementInfo(el),
        url: location.href,
        title: document.title,
        timestamp: Date.now(),
        viewport: getViewportInfo(),
      });
    }
  }, true);

  // Copy/Cut/Paste 不在这里监听 — 全局监听器已通过键盘快捷键捕获（Ctrl+C/X/V）
  // 避免同一个操作记录两次

})();

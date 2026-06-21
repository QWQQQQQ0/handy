// 点击后输出所有 y/height 相关的 JS 可获取变量

(() => {
  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const body = document.body;
    const html = document.documentElement;

    const data = {
      // ── 事件坐标 ──
      'e.clientY': e.clientY,
      'e.pageY': e.pageY,
      'e.screenY': e.screenY,
      'e.offsetY': e.offsetY,
      'e.movementY': e.movementY,

      // ── 窗口/视口 ──
      'window.scrollY': window.scrollY,
      'window.pageYOffset': window.pageYOffset,
      'window.screenY': window.screenY,
      'window.outerHeight': window.outerHeight,
      'window.innerHeight': window.innerHeight,
      'window.visualViewport.height': window.visualViewport?.height,
      'window.visualViewport.offsetTop': window.visualViewport?.offsetTop,
      'window.visualViewport.pageTop': window.visualViewport?.pageTop,

      // ── 屏幕 ──
      'screen.height': screen.height,
      'screen.availHeight': screen.availHeight,
      'screenTop': window.screenTop,

      // ── 元素 rect (getBoundingClientRect) ──
      'rect.top': rect.top,
      'rect.bottom': rect.bottom,
      'rect.y': rect.y,
      'rect.height': rect.height,

      // ── 元素 offset ──
      'el.offsetTop': el.offsetTop,
      'el.offsetHeight': el.offsetHeight,
      'el.offsetParent': el.offsetParent?.tagName ?? null,

      // ── 元素 client ──
      'el.clientTop': el.clientTop,
      'el.clientHeight': el.clientHeight,

      // ── 元素 scroll ──
      'el.scrollTop': el.scrollTop,
      'el.scrollHeight': el.scrollHeight,

      // ── 计算样式 ──
      'cs.height': cs.height,
      'cs.minHeight': cs.minHeight,
      'cs.maxHeight': cs.maxHeight,
      'cs.top': cs.top,
      'cs.bottom': cs.bottom,
      'cs.marginTop': cs.marginTop,
      'cs.marginBottom': cs.marginBottom,
      'cs.paddingTop': cs.paddingTop,
      'cs.paddingBottom': cs.paddingBottom,
      'cs.position': cs.position,
      'cs.display': cs.display,
      'cs.overflow': cs.overflow,
      'cs.overflowY': cs.overflowY,
      'cs.boxSizing': cs.boxSizing,
      'cs.transform': cs.transform,
      'cs.transformOrigin': cs.transformOrigin,

      // ── document / body / html ──
      'document.body.scrollTop': body.scrollTop,
      'document.body.scrollHeight': body.scrollHeight,
      'document.body.offsetHeight': body.offsetHeight,
      'document.body.clientHeight': body.clientHeight,
      'document.documentElement.scrollTop': html.scrollTop,
      'document.documentElement.scrollHeight': html.scrollHeight,
      'document.documentElement.offsetHeight': html.offsetHeight,
      'document.documentElement.clientHeight': html.clientHeight,

      // ── 累积 offsetParent 链 ──
      'offsetParentChain': (() => {
        const chain = [];
        let cur = el;
        while (cur && cur !== document.body) {
          chain.push({
            tag: cur.tagName,
            offsetTop: cur.offsetTop,
            offsetHeight: cur.offsetHeight,
            scrollTop: cur.scrollTop,
          });
          cur = cur.offsetParent;
        }
        return chain;
      })(),

      // ── 累积 getBoundingClientRect 链 ──
      'rectParentChain': (() => {
        const chain = [];
        let cur = el;
        let depth = 0;
        while (cur && depth < 5) {
          const r = cur.getBoundingClientRect();
          chain.push({
            tag: cur.tagName,
            top: r.top,
            height: r.height,
          });
          cur = cur.parentElement;
          depth++;
        }
        return chain;
      })(),
    };

    console.log(JSON.stringify(data, null, 2));
    return false;
  };

  document.addEventListener('click', handler, { capture: true });
  window.__stopClickDebug = () => {
    document.removeEventListener('click', handler, { capture: true });
    console.log('stopped');
  };
})();

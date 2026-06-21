// Background service worker — connects to OpenPaw Python backend via WebSocket.
// Allows the desktop app to inject scripts and query DOM through the extension.
//
// MV3 service workers are ephemeral — Chrome kills them after ~30s of
// inactivity.  We keep the worker alive with chrome.alarms (the only
// reliable keepalive in MV3) and reconnect the WebSocket on wake.

const WS_URL = 'ws://127.0.0.1:19840/extension';
const KEEPALIVE_ALARM = 'openpaw-keepalive';
const RECONNECT_ALARM = 'openpaw-reconnect';

let ws = null;
let lastPong = 0;  // timestamp of last pong received from server
let _reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30; // seconds

// Physical screen size from Python backend (used to fix coordinate scaling)
let _physicalScreen = { width: 0, height: 0 };

// ── User event buffer (populated by content scripts, pushed to backend) ──
const _userEvents = [];
const MAX_EVENTS = 200;
let _captureEnabled = false;  // global capture state

// ── Listen for events from content scripts ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'user_event' && msg.data) {
    msg.data.tabId = sender.tab?.id;
    msg.data.frameId = sender.frameId;

    // Push to backend via WebSocket immediately
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'push_event', data: msg.data }));
      } catch (e) {
        console.warn('[OpenPaw] push_event failed, buffering:', e);
        _userEvents.push(msg.data);
      }
    } else {
      _userEvents.push(msg.data);
    }

    // Trim buffer
    if (_userEvents.length > MAX_EVENTS) {
      _userEvents.splice(0, _userEvents.length - MAX_EVENTS);
    }
    sendResponse({ ok: true });
  }
});

// ── Re-enable capture on page navigation (content script resets on navigation) ──
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && _captureEnabled) {
    chrome.tabs.sendMessage(tabId, { type: 'set_capture_enabled', enabled: true }).catch(() => {});
  }
});

// ── Keepalive: fire every 15s to prevent Chrome from killing the SW ──
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.25 }); // ~15s
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect();
    } else if (Date.now() - lastPong > 30000) {
      // Connection is half-open: readyState is OPEN but server is dead
      console.log('[OpenPaw] heartbeat timeout, reconnecting');
      try { ws.close(); } catch {}
    } else {
      // Send heartbeat ping to verify connection is alive
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
    }
  }
});

/** Enable event capture in all existing tabs */
function enableCaptureAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'set_capture_enabled', enabled: true }).catch(() => {});
      }
    }
  });
}

/** Broadcast a message to all tabs */
function broadcastToTabs(msg) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    }
  });
}

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  // Close stale socket if any
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    try { ws.close(); } catch {}
  }
  ws = null;

  try {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      console.log('[OpenPaw] connected to backend');
      lastPong = Date.now();
      _reconnectAttempts = 0;
      chrome.alarms.clear(RECONNECT_ALARM);
    };
    ws.onmessage = async (event) => {
      let msg = null;
      try {
        msg = JSON.parse(event.data);
        // Handle server pong (heartbeat response)
        if (msg.type === 'pong') {
          lastPong = Date.now();
          return;
        }
        // Handle screen info from backend
        if (msg.type === 'screen_info' && msg.data) {
          _physicalScreen.width = msg.data.width || 0;
          _physicalScreen.height = msg.data.height || 0;
          console.log(`[OpenPaw] physical screen: ${_physicalScreen.width}x${_physicalScreen.height}`);
          // Forward to all content scripts
          broadcastToTabs({ type: 'screen_info', data: _physicalScreen });
          return;
        }
        const result = await handleCommand(msg);
        ws.send(JSON.stringify({ id: msg.id, ok: true, data: result }));
      } catch (e) {
        const id = msg?.id || '';
        try { ws.send(JSON.stringify({ id, ok: false, error: String(e) })); } catch {}
      }
    };
    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };
    ws.onerror = (e) => {
      console.warn('[OpenPaw] ws error', e);
      try { ws.close(); } catch {}
      ws = null;
    };
  } catch (e) {
    console.warn('[OpenPaw] connect() threw', e);
    ws = null;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (cap)
  _reconnectAttempts++;
  const delaySec = Math.min(Math.pow(2, _reconnectAttempts - 1), MAX_RECONNECT_DELAY);
  console.log(`[OpenPaw] reconnect #${_reconnectAttempts} in ${delaySec}s`);
  chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: delaySec / 60 });
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) {
    connect();
  }
});

async function handleCommand(msg) {
  const { id, tool, params } = msg;
  if (tool !== 'ext_get_recorded_events') {
    console.log(`[OpenPaw] handleCommand: tool=${tool} id=${id}`);
  }

  switch (tool) {
    case 'ext_get_tab_info': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { tabId: tab?.id, url: tab?.url, title: tab?.title };
    }
    case 'ext_execute_script': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab');
      const code = params?.code;
      if (!code) throw new Error('No code provided');
      try {
        // Pass code as string argument, use world:"MAIN" + indirect eval.
        // The func body is a STATIC function (no new Function) so Chrome
        // can serialize it without triggering CSP.
        // (0, eval)(x) is indirect eval — runs in global scope.
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: params?.allFrames ?? false },
          world: 'MAIN',
          func: (__code) => {
            const result = (0, eval)(__code);
            // If code was an arrow/function expression, invoke it
            return typeof result === 'function' ? result() : result;
          },
          args: [code],
        });
        return { results: results.map(r => r.result) };
      } catch (scriptErr) {
        console.error(`[OpenPaw] executeScript error: ${scriptErr}`);
        throw new Error(`Script execution failed: ${scriptErr.message || scriptErr}`);
      }
    }
    case 'ext_get_interactive': {
      // Predefined static function — NO eval, NO new Function.
      // Works regardless of page CSP.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab');
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          const selector = 'a,button,input,select,textarea,[role="button"],[role="link"],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="listitem"],[role="treeitem"],[contenteditable="true"]';
          const nodes = Array.from(document.querySelectorAll(selector))
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
              selector: el.id ? '#' + CSS.escape(el.id) : '',
              text: (el.textContent || '').trim().substring(0, 120),
              bounds: (() => {
                const r = el.getBoundingClientRect();
                return {left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height)};
              })(),
            }));
          return {nodes, url: window.location.href, title: document.title};
        },
      });
      return { results: results.map(r => r.result) };
    }
    case 'ext_get_recorded_events': {
      // Drain all buffered user events from content scripts
      const events = _userEvents.splice(0, _userEvents.length);
      return { events, screen: _physicalScreen };
    }
    case 'ext_peek_recorded_events': {
      // Return a copy without draining (for debugging)
      return { events: [..._userEvents], count: _userEvents.length };
    }
    case 'ext_set_capture': {
      // Enable/disable event capture in all content scripts
      const enabled = params?.enabled ?? false;
      _captureEnabled = enabled;
      try {
        const tabs = await chrome.tabs.query({});
        let injected = 0;
        for (const tab of tabs) {
          if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('chrome-extension://')) {
            try {
              // 设置页面全局标记，内容脚本通过读取此标记判断是否启用
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: 'MAIN',
                func: (__enabled) => {
                  window.__openpaw_capture_enabled = __enabled;
                },
                args: [enabled],
              });
              // 同时尝试通过消息通道设置
              chrome.tabs.sendMessage(tab.id, { type: 'set_capture_enabled', enabled }).catch(() => {});
              injected++;
            } catch {}
          }
        }
        console.log(`[OpenPaw] ext_set_capture: enabled=${enabled}, injected to ${injected}/${tabs.length} tabs`);
      } catch {}
      // Clear buffer when disabling
      if (!enabled) _userEvents.length = 0;
      return { ok: true, enabled };
    }
    default:
      throw new Error(`Unknown extension command: ${tool}`);
  }
}

// Start connection on install / startup
connect();
chrome.runtime.onStartup?.addListener(connect);
chrome.runtime.onInstalled?.addListener(connect);

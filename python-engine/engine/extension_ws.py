"""WebSocket server for Chrome extension communication.

Listens on ws://127.0.0.1:19840/extension and routes commands
to the BrowserEngine.
"""

import asyncio
import json
import os
import sys
import threading
import traceback
from typing import Any

PORT = 19840


def _log(msg: str) -> None:
    print(f"[ext-ws] {msg}", file=sys.stderr, flush=True)

# Global reference to the browser engine, set from main.py
_browser_engine = None

# Track active extension connections
_active_connections: set = set()
_extension_connected = False


def set_browser_engine(engine):
    """Set the browser engine instance for extension commands."""
    global _browser_engine
    _browser_engine = engine


def is_extension_connected() -> bool:
    """Check if any Chrome extension is currently connected."""
    return len(_active_connections) > 0


def get_browser_status() -> dict[str, Any]:
    """Get browser connection status including URL if available."""
    extension_connected = len(_active_connections) > 0
    playwright_launched = _browser_engine is not None and _browser_engine._page is not None

    result = {
        "extension_connected": extension_connected,
        "playwright_launched": playwright_launched,
        "connected": extension_connected or playwright_launched,
    }

    if playwright_launched:
        try:
            result["url"] = _browser_engine._page.url
        except Exception:
            pass

    return result


# ── Send command TO extension via WebSocket ──
import uuid
import threading
import asyncio
from collections import deque

# Pending requests waiting for extension response
# Each entry: {msg_id: {"event": threading.Event, "result": dict}}
_pending_requests: dict[str, dict] = {}
_pending_lock = threading.Lock()

# Queue for sending messages to extension (populated by sync code, consumed by async handler)
_outgoing_queue: deque = deque()
_outgoing_event = threading.Event()

# Store the event loop reference for the async handler
_handler_loop: asyncio.AbstractEventLoop | None = None


def send_to_extension_sync(tool: str, params: dict, timeout: float = 30) -> dict[str, Any]:
    """Send a command to the connected extension and wait for response (synchronous)."""
    if not _active_connections:
        return {"ok": False, "error": "No extension connected"}

    msg_id = str(uuid.uuid4())
    msg = json.dumps({"id": msg_id, "tool": tool, "params": params})

    # Create event to wait for response
    event = threading.Event()
    result_holder = {"result": None}

    with _pending_lock:
        _pending_requests[msg_id] = {"event": event, "result": result_holder, "tool": tool}

    try:
        # Add message to outgoing queue for the async handler to send
        _outgoing_queue.append(msg)
        _outgoing_event.set()

        # Wait for response
        if event.wait(timeout=timeout):
            return result_holder["result"] or {"ok": False, "error": "Empty response"}
        else:
            _log(f"timeout waiting for response id={msg_id} tool={tool}")
            return {"ok": False, "error": "Extension response timeout"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        with _pending_lock:
            _pending_requests.pop(msg_id, None)


def _cancel_all_pending(reason: str) -> None:
    """Cancel all pending requests (e.g., when connection drops)."""
    with _pending_lock:
        pending_ids = list(_pending_requests.keys())
        for msg_id in pending_ids:
            entry = _pending_requests.pop(msg_id, None)
            if entry:
                entry["result"]["result"] = {"ok": False, "error": reason}
                entry["event"].set()
    if pending_ids:
        _log(f"cancelled {len(pending_ids)} pending requests: {reason}")


def _handle_command(tool: str, params: dict) -> dict[str, Any]:
    """Route extension commands.

    If Playwright is launched, use it directly.
    If extension is connected but Playwright is not, forward command to extension via WebSocket.
    """
    # Try Playwright first if available
    if _browser_engine and _browser_engine._page:
        try:
            if tool == "ext_get_tab_info":
                page = _browser_engine._page
                return {
                    "ok": True,
                    "data": {
                        "tabId": 0,
                        "url": page.url,
                        "title": page.title(),
                    },
                }
            elif tool == "ext_execute_script":
                page = _browser_engine._page
                code = params.get("code", "")
                result = page.evaluate(code)
                return {"ok": True, "data": {"results": [result]}}
        except Exception as e:
            _log(f"Playwright command error ({tool}): {e}")
            # Fall through to extension if available

    # Forward to extension via WebSocket
    if _active_connections:
        return send_to_extension_sync(tool, params)

    return {"ok": False, "error": "No browser available (neither Playwright nor extension)"}


def _get_physical_screen_size() -> dict[str, int]:
    """Get physical screen resolution (not affected by DPI scaling)."""
    try:
        import ctypes
        user32 = ctypes.windll.user32
        # SM_CXSCREEN=0, SM_CYSCREEN=1 — physical pixels
        w = user32.GetSystemMetrics(0)
        h = user32.GetSystemMetrics(1)
        return {"width": w, "height": h}
    except Exception:
        return {"width": 1920, "height": 1080}


async def _handler(websocket):
    """Handle a single WebSocket connection from the Chrome extension.

    The extension sends responses to our requests (with matching msg_id).
    We also handle commands FROM the extension (though currently the extension
    only sends responses, not commands).
    """
    addr = websocket.remote_address
    _active_connections.add(websocket)
    global _extension_connected
    _extension_connected = True
    _log(f"connected: {addr} (total: {len(_active_connections)})")

    # Send physical screen size to extension on connect
    screen_size = _get_physical_screen_size()
    try:
        await websocket.send(json.dumps({
            "type": "screen_info",
            "data": screen_size,
        }))
        _log(f"sent screen_info: {screen_size}")
    except Exception as e:
        _log(f"failed to send screen_info: {e}")

    # Start a task to process outgoing messages
    async def process_outgoing():
        while True:
            # Process all queued messages first
            while _outgoing_queue:
                msg = _outgoing_queue.popleft()
                try:
                    await websocket.send(msg)
                    # 轮询工具不打日志
                    try:
                        _tool = json.loads(msg).get("tool", "")
                    except Exception:
                        _tool = ""
                    if _tool != "ext_get_recorded_events":
                        _log(f"sent outgoing: {msg[:100]}...")
                except Exception as e:
                    _log(f"send error: {e}")
                    # Connection broken — cancel all pending so callers don't hang
                    _cancel_all_pending(f"WebSocket send error: {e}")
                    return
            # Queue empty — clear event BEFORE waiting to avoid race condition
            _outgoing_event.clear()
            # Wait for new messages (in executor to avoid blocking event loop)
            await asyncio.get_event_loop().run_in_executor(None, _outgoing_event.wait)

    outgoing_task = asyncio.create_task(process_outgoing())

    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
                msg_id = msg.get("id", "")

                # Handle heartbeat ping from extension
                if msg.get("type") == "ping":
                    await websocket.send(json.dumps({"type": "pong"}))
                    continue

                # Check if this is a response to a pending request
                with _pending_lock:
                    pending = _pending_requests.get(msg_id)
                if pending:
                    pending["result"]["result"] = msg
                    pending["event"].set()
                    # 轮询工具无事件时不打日志
                    is_polling = pending.get("tool") == "ext_get_recorded_events"
                    has_events = bool(msg.get("data", {}).get("events"))

                    # Forward extension events to event collector
                    if is_polling and has_events:
                        try:
                            from engine.event_collector import get_collector
                            collector = get_collector()
                            for evt in msg.get("data", {}).get("events", []):
                                # Map extension event fields to match global format
                                evt["event_type"] = evt.get("type", "")
                                collector.put_extension_event(evt)
                        except Exception:
                            pass

                    if not is_polling or has_events:
                        _log(f"recv id={msg_id} tool={pending.get('tool')} data={str(msg.get('data',''))[:200]}")
                    continue

                # Handle pushed events from extension (real-time)
                if msg.get("type") == "push_event" and msg.get("data"):
                    try:
                        from engine.event_collector import get_collector
                        collector = get_collector()
                        if collector.is_recording:
                            evt = msg["data"]
                            # 不覆盖 type 字段，put_extension_event 读取的是 type
                            collector.put_extension_event(evt)
                    except Exception:
                        pass
                    continue

                # Otherwise, treat as a command FROM the extension (legacy)
                tool = msg.get("tool", "")
                params = msg.get("params", {})
                _log(f"dispatch from ext: tool={tool} id={msg_id}")

                result = _handle_command(tool, params)
                result["id"] = msg_id
                resp = json.dumps(result)
                _log(f"respond: tool={tool} ok={result.get('ok')} len={len(resp)}")
                await websocket.send(resp)
            except json.JSONDecodeError as e:
                _log(f"JSON decode error: {e}  raw={raw[:200]}")
                await websocket.send(json.dumps({"id": "", "ok": False, "error": "Invalid JSON"}))
            except Exception as e:
                _log(f"handler error: {e}\n{traceback.format_exc()}")
                await websocket.send(json.dumps({"id": "", "ok": False, "error": str(e)}))
    except Exception as e:
        _log(f"connection error ({addr}): {type(e).__name__}: {e}")
    finally:
        outgoing_task.cancel()
        _active_connections.discard(websocket)
        _extension_connected = len(_active_connections) > 0
        _log(f"disconnected: {addr} (remaining: {len(_active_connections)})")
        # Cancel any pending requests so callers don't hang until timeout
        _cancel_all_pending("Extension disconnected")


def _kill_port_owner(port: int) -> None:
    """Kill any process listening on the given port (Windows)."""
    import subprocess
    try:
        result = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True, text=True, timeout=5,
        )
        for line in result.stdout.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                pid = line.strip().split()[-1]
                if pid.isdigit() and int(pid) != os.getpid():
                    _log(f"killing old process PID={pid} on port {port}")
                    subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True, timeout=5)
    except Exception as e:
        _log(f"port cleanup failed: {e}")


async def _run_server():
    """Start the WebSocket server."""
    import websockets

    # Kill any leftover process on this port before binding
    _kill_port_owner(PORT)

    _log(f"websockets version: {websockets.__version__}")
    async with websockets.serve(_handler, "127.0.0.1", PORT):
        _log(f"listening on ws://127.0.0.1:{PORT}/extension")
        await asyncio.Future()  # run forever


def start_extension_ws_server():
    """Start the WebSocket server in a background daemon thread."""
    def _thread_target():
        try:
            asyncio.run(_run_server())
        except Exception as e:
            _log(f"server error: {type(e).__name__}: {e}\n{traceback.format_exc()}")

    t = threading.Thread(target=_thread_target, daemon=True, name="ext-ws")
    t.start()
    _log(f"background thread started (tid={t.ident})")

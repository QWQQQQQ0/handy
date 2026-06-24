// Gesture classifier: receives raw mousedown/mouseup events, outputs classified gestures.
//
// Pure timestamp-driven — no setTimeout dependency. On each process() call,
// flushStale() cleans expired state. In batch-polling scenarios where multiple
// events arrive synchronously, the state machine judges by timestamp, not timer.
//
//   mousedown → output immediately (UI feedback)
//   mouseup   → held, wait for classification
//     single-click confirmed → replace mousedown with click
//     double-click confirmed → replace 2×mousedown + 2×mouseup with dblclick
//     long-press confirmed → mark down+up with longPress flag

import type { SemanticEvent } from '@/types/semantic-event';

const LONG_PRESS_MS = 500;
const DBLCLICK_WINDOW_MS = 400;

export class GestureClassifier {
  private state: 'idle' | 'pending' | 'wait_second_down' | 'wait_second_up' = 'idle';
  private downRef: SemanticEvent | null = null;
  private downRef2: SemanticEvent | null = null;
  private downTs = 0;
  /** Timestamp when entering wait_second_down (first mouseup time) */
  private upTs = 0;
  private onReplace: ((oldEvt: SemanticEvent, newEvt: SemanticEvent) => void) | null = null;
  private onRemove: ((evt: SemanticEvent) => void) | null = null;
  private onEmit: ((evt: SemanticEvent) => void) | null = null;

  setCallbacks(opts: {
    onReplace: (oldEvt: SemanticEvent, newEvt: SemanticEvent) => void;
    onRemove: (evt: SemanticEvent) => void;
    onEmit: (evt: SemanticEvent) => void;
  }) {
    this.onReplace = opts.onReplace;
    this.onRemove = opts.onRemove;
    this.onEmit = opts.onEmit;
  }

  reset() {
    this.state = 'idle';
    this.downRef = null;
    this.downRef2 = null;
    this.downTs = 0;
    this.upTs = 0;
  }

  /**
   * Clean up expired state (pure timestamp-driven, no setTimeout).
   * Call at the start of each process() and at end-of-batch / recording stop.
   *
   * @param nowTs Current reference timestamp (new event's timestamp, or Date.now())
   */
  flushStale(nowTs: number): void {
    // ── wait_second_down timeout → confirm single click ──
    if (this.state === 'wait_second_down' && (nowTs - this.upTs) > DBLCLICK_WINDOW_MS) {
      console.log(`[GestureClassifier] flushStale → click (gap=${nowTs - this.upTs}ms > ${DBLCLICK_WINDOW_MS}ms)`);
      const click = this.makeGesture('click', this.upTs, this.downRef!);
      this.onReplace?.(this.downRef!, click);
      this.state = 'idle';
      this.downRef = null;
      this.downRef2 = null;
      this.downTs = 0;
      this.upTs = 0;
      return;
    }

    // ── wait_second_up timeout → second mouseup never arrived, downgrade to two independent clicks ──
    if (this.state === 'wait_second_up' && (nowTs - this.downTs) > LONG_PRESS_MS) {
      console.log(`[GestureClassifier] flushStale → wait_second_up timeout, splitting into 2 clicks`);
      const click1 = this.makeGesture('click', this.upTs, this.downRef!);
      this.onReplace?.(this.downRef!, click1);
      if (this.downRef2) {
        this.downRef = this.downRef2;
        this.downTs = this.downRef2.timestamp;
        this.downRef2 = null;
        this.upTs = 0;
        this.state = 'pending';
        console.log(`[GestureClassifier] → downRef2 rolled into pending, ts=${this.downTs}`);
      } else {
        this.reset();
      }
    }
  }

  /**
   * Process one event. Returns true if consumed (don't add to timeline directly),
   * false if the event should be added to the timeline.
   */
  process(evt: SemanticEvent): boolean {
    const action = evt.action;
    const ts = evt.timestamp;

    // ── Entry flush: any event (mouse/keyboard/scroll) can trigger stale state cleanup ──
    this.flushStale(ts);

    const isMouseDown = action.type === 'mousedown' || (action.type as string) === 'mouse_down';
    const isMouseUp = action.type === 'mouseup' || (action.type as string) === 'mouse_up';
    if (!isMouseDown && !isMouseUp) return false;

    if (isMouseDown) {
      if (this.state === 'wait_second_down') {
        const gap = ts - this.upTs;
        if (gap > DBLCLICK_WINDOW_MS) {
          console.log(`[GestureClassifier] mousedown₂ ts=${ts} gap=${gap}ms > ${DBLCLICK_WINDOW_MS}ms → settling click & restart`);
          const click = this.makeGesture('click', this.upTs, this.downRef!);
          this.onReplace?.(this.downRef!, click);
          this.downRef = evt;
          this.downRef2 = null;
          this.downTs = ts;
          this.upTs = 0;
          this.state = 'pending';
          return false;
        }
        this.downRef2 = evt;
        this.downTs = ts;
        this.state = 'wait_second_up';
        console.log(`[GestureClassifier] mousedown₂ ts=${ts} gap=${gap}ms ≤ ${DBLCLICK_WINDOW_MS}ms, state→wait_second_up`);
        return false;
      }

      if (this.state === 'idle' || this.state === 'pending') {
        this.downRef = evt;
        this.downRef2 = null;
        this.downTs = ts;
        this.state = 'pending';
        console.log(`[GestureClassifier] mousedown₁ ts=${ts}, state→pending`);
        return false;
      }

      if (this.state === 'wait_second_up') return true;
      return false;
    }

    // ── isMouseUp ──
    if (this.state === 'pending') {
      const duration = ts - this.downTs;
      console.log(`[GestureClassifier] mouseup₁ ts=${ts}, duration=${duration}ms`);
      if (duration > LONG_PRESS_MS) {
        if (this.downRef) this.downRef.action.params = { ...this.downRef.action.params, longPress: true };
        evt.action.params = { ...evt.action.params, longPress: true };
        console.log(`[GestureClassifier] → long_press (${duration}ms)`);
        this.reset();
        return false;
      }
      this.state = 'wait_second_down';
      this.upTs = ts;
      console.log(`[GestureClassifier] → waiting for second click, upTs=${ts}`);
      return true;
    }

    // Duplicate mouseup from global+extension: first one consumed (state→wait_second_down),
    // second arrival silently discarded.
    if (this.state === 'wait_second_down') {
      return true;
    }

    if (this.state === 'wait_second_up') {
      console.log(`[GestureClassifier] mouseup₂ ts=${ts} → dblclick`);
      if (this.downRef) {
        const dblclick = this.makeGesture('double_click', ts, this.downRef);
        this.onReplace?.(this.downRef, dblclick);
        if (this.downRef2) this.onRemove?.(this.downRef2);
      }
      this.reset();
      return true;
    }

    return true;
  }

  private makeGesture(type: string, ts: number, ref: SemanticEvent): SemanticEvent {
    return {
      id: crypto.randomUUID(),
      timestamp: ts,
      action: { type, target: ref.action.target },
      element: ref.element,
      context: ref.context,
    };
  }
}

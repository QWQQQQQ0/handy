/**
 * App Events — simple event bus for real-time app updates.
 *
 * Used to notify the Apps page when new HTML code is generated
 * so the preview can update in real-time.
 */

type EventCallback = (...args: unknown[]) => void;

class AppEventBus {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  /**
   * Subscribe to an event.
   */
  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  /**
   * Subscribe to an event (one-time only).
   */
  once(event: string, callback: EventCallback): () => void {
    const wrappedCallback: EventCallback = (...args) => {
      callback(...args);
      this.off(event, wrappedCallback);
    };
    return this.on(event, wrappedCallback);
  }

  /**
   * Unsubscribe from an event.
   */
  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  /**
   * Emit an event.
   */
  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((callback) => {
      try {
        callback(...args);
      } catch (err) {
        console.error(`[AppEventBus] Error in listener for "${event}":`, err);
      }
    });
  }

  /**
   * Remove all listeners for an event or all events.
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

// Singleton instance
export const appEvents = new AppEventBus();

// Event types
export const APP_EVENTS = {
  /** Emitted when a new app is created */
  APP_CREATED: 'app:created',
  /** Emitted when an app is updated */
  APP_UPDATED: 'app:updated',
  /** Emitted when an app is deleted */
  APP_DELETED: 'app:deleted',
  /** Emitted when HTML code is generated and ready for preview */
  HTML_GENERATED: 'html:generated',
} as const;

// Event payload types
export interface AppCreatedEvent {
  id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface AppUpdatedEvent {
  id: string;
  name?: string;
  code?: string;
}

export interface AppDeletedEvent {
  id: string;
}

export interface HTMLGeneratedEvent {
  appId?: string;
  name: string;
  code: string;
  autoSave?: boolean;
}

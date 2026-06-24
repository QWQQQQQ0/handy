// Task factory — creates Tickable from TaskConfig.
// Types are unified: TaskConfig is the single source of truth.
// migrateWatcherConfig removed — no longer needed.

import type { TaskConfig, Tickable } from '@/types/scheduler';
import { ScreenChangeWatcher } from './screen-change-watcher';
import { TimerWatcher } from './timer-watcher';

export function createTask(config: TaskConfig): Tickable {
  switch (config.trigger.type) {
    case 'screen_change': return new ScreenChangeWatcher(config);
    case 'timer': return new TimerWatcher(config);
    default: throw new Error(`Unknown trigger type: ${(config.trigger as any).type}`);
  }
}

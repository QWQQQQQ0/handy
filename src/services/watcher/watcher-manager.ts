// ScheduledTaskManager — singleton backed by TickLoop.
// Handles lifecycle (create/start/stop/remove), persistence, auto-restore, and cross-window sync.
// Formerly WatcherManager — now handles all scheduled task types (timer, screen_change, event).

import type { TaskConfig, Tickable } from '@/types/scheduler';
import type { ScreenRegion, MonitorTarget, WorkflowStep, WorkflowTemplate } from '@/types/watcher';
import type { ScreenChangeWatcher } from '@/services/scheduler/screen-change-watcher';
import { TickLoop } from '@/services/scheduler/scheduler';
import { createTask } from '@/services/scheduler/task-factory';
import {
  storeScheduledTask,
  getAllScheduledTasks,
  deleteScheduledTask,
} from '@/services/cache-service';
import { appEventBus } from '@/services/event-bus';

class ScheduledTaskManager {
  private loop = new TickLoop();
  private syncUnlisten: (() => void) | null = null;
  // Store original TaskConfig for getStates() and update()
  private configStore: Map<string, TaskConfig> = new Map();

  async initSync(): Promise<void> {
    if (this.syncUnlisten) return;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const currentLabel = getCurrentWebviewWindow().label;

      this.syncUnlisten = await listen<{ id: string; enabled: boolean; sourceLabel: string }>(
        'scheduled-task-toggle',
        (event) => {
          if (event.payload.sourceLabel === currentLabel) return;
          const { id, enabled } = event.payload;
          if (enabled) this.start(id).catch(() => {});
          else {
            this.loop.get(id)?.stop();
          }
        },
      );
    } catch { /* not in Tauri */ }
  }

  destroySync(): void {
    this.syncUnlisten?.();
    this.syncUnlisten = null;
  }

  private async emitToggle(id: string, enabled: boolean): Promise<void> {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      await emit('scheduled-task-toggle', { id, enabled, sourceLabel: getCurrentWebviewWindow().label });
    } catch { /* not in Tauri */ }
  }

  /** 为 ScreenChangeWatcher 设置 region 持久化回调 */
  private wireRegionPersistence(task: Tickable, id: string): void {
    if ('setOnRegionResolved' in task && typeof task.setOnRegionResolved === 'function') {
      (task as unknown as ScreenChangeWatcher).setOnRegionResolved(async (region: ScreenRegion, monitorTarget?: MonitorTarget) => {
        let config = this.configStore.get(id);
        if (config && config.trigger.type === 'screen_change') {
          const updated: TaskConfig = {
            ...config,
            trigger: { ...config.trigger, region, ...(monitorTarget ? { monitorTarget } : {}) },
            updatedAt: Math.floor(Date.now() / 1000),
          };
          // 不持久化 windowHwnd
          if (updated.trigger.type === 'screen_change' && updated.trigger.monitorTarget?.windowHwnd) {
            delete (updated.trigger.monitorTarget as any).windowHwnd;
          }
          await storeScheduledTask(updated);
          this.configStore.set(id, updated);
        }
      });
    }
  }

  /** 为 ScreenChangeWatcher 设置执行完成回调 */
  private wireExecutionComplete(task: Tickable, id: string): void {
    if ('setOnExecutionComplete' in task && typeof task.setOnExecutionComplete === 'function') {
      (task as unknown as ScreenChangeWatcher).setOnExecutionComplete(async (success: boolean, summary: string) => {
        let config = this.configStore.get(id);
        if (config && config.action.type === 'agent_execute') {
          const updated: TaskConfig = {
            ...config,
            action: {
              ...config.action,
              lastExecution: {
                timestamp: Date.now(),
                success,
                summary,
                turnsCount: 0,
              },
              executionCount: success ? (config.action.executionCount ?? 0) + 1 : config.action.executionCount,
            },
            updatedAt: Math.floor(Date.now() / 1000),
          };
          // 不持久化 windowHwnd
          if (updated.trigger.type === 'screen_change' && updated.trigger.monitorTarget?.windowHwnd) {
            delete (updated.trigger.monitorTarget as any).windowHwnd;
          }
          await storeScheduledTask(updated);
          this.configStore.set(id, updated);
          const task = this.loop.get(id);
          if (task && 'updateConfig' in task) {
            (task as unknown as { updateConfig(c: TaskConfig): void }).updateConfig(updated);
          }
        }
      });
    }
  }

  /** 为 ScreenChangeWatcher 设置工作流模板学习回调 */
  private wireWorkflowTemplate(task: Tickable, id: string): void {
    if ('setOnWorkflowLearned' in task && typeof task.setOnWorkflowLearned === 'function') {
      (task as unknown as ScreenChangeWatcher).setOnWorkflowLearned(async (template: WorkflowStep[]) => {
        let config = this.configStore.get(id);
        if (config && config.action.type === 'agent_execute') {
          const workflowTemplate: WorkflowTemplate = {
            id: crypto.randomUUID(),
            name: config.name,
            scenario: config.action.goalTemplate || '',
            steps: template.map(step => ({
              type: 'action' as const,
              params: {},
              action: step.type === 'action' ? step.action : undefined,
              description: step.type === 'action' ? step.action.action : 'llm_generate',
            })) as any,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            successCount: 0,
          };

          const updated: TaskConfig = {
            ...config,
            action: {
              ...config.action,
              workflowTemplate,
              executionCount: (config.action.executionCount ?? 0) + 1,
            },
            updatedAt: Math.floor(Date.now() / 1000),
          };
          if (updated.trigger.type === 'screen_change' && updated.trigger.monitorTarget?.windowHwnd) {
            delete (updated.trigger.monitorTarget as any).windowHwnd;
          }
          await storeScheduledTask(updated);
          this.configStore.set(id, updated);
          const task = this.loop.get(id);
          if (task && 'updateConfig' in task) {
            (task as unknown as { updateConfig(c: TaskConfig): void }).updateConfig(updated);
          }
        }
      });
    }
  }

  async create(config: TaskConfig): Promise<void> {
    // windowHwnd 是运行时值，不持久化
    if (config.trigger.type === 'screen_change' && config.trigger.monitorTarget?.windowHwnd) {
      delete (config.trigger.monitorTarget as any).windowHwnd;
    }
    await storeScheduledTask(config);
    this.configStore.set(config.id, config);

    const task = createTask(config);
    this.wireRegionPersistence(task, config.id);
    this.wireWorkflowTemplate(task, config.id);
    this.wireExecutionComplete(task, config.id);

    this.loop.add(task);
    if (config.enabled) {
      await task.start();
    }

    if (config.enabled) {
      await this.emitToggle(config.id, true);
    }

    this.emitStateChange(config.id, 'created');
  }

  /** 手动触发区域重新定位 */
  async reResolveRegion(id: string): Promise<void> {
    const task = this.loop.get(id);
    if (!task || !('reResolveRegion' in task)) return;
    try {
      await (task as unknown as ScreenChangeWatcher).reResolveRegion();
    } catch { /* ignore */ }
  }

  async start(id: string): Promise<void> {
    const task = this.loop.get(id);
    if (task) {
      await task.start();
    } else {
      // Task not in loop — try loading from DB
      const configs = await getAllScheduledTasks();
      const config = configs.find(c => c.id === id);
      if (config) {
        this.configStore.set(id, config);
        const newTask = createTask(config);
        this.wireRegionPersistence(newTask, id);
        this.wireWorkflowTemplate(newTask, id);
        this.wireExecutionComplete(newTask, id);
        this.loop.add(newTask);
        if (config.enabled) {
          await newTask.start();
        }
      }
    }
  }

  pause(id: string): void {
    this.loop.get(id)?.stop();
  }

  resume(id: string): void {
    this.loop.get(id)?.start();
  }

  async remove(id: string): Promise<void> {
    this.loop.remove(id);
    this.configStore.delete(id);
    await deleteScheduledTask(id);
    await this.emitToggle(id, false);
    this.emitStateChange(id, 'removed');
  }

  async update(id: string, patch: Partial<TaskConfig>): Promise<void> {
    let config = this.configStore.get(id);

    if (!config) {
      const configs = await getAllScheduledTasks();
      config = configs.find(c => c.id === id);
      if (!config) return;
    }

    const updated: TaskConfig = { ...config, ...patch, updatedAt: Math.floor(Date.now() / 1000) };
    // windowHwnd 是运行时值（每次启动都变），不能持久化
    if (updated.trigger.type === 'screen_change' && updated.trigger.monitorTarget?.windowHwnd) {
      delete (updated.trigger.monitorTarget as any).windowHwnd;
    }
    await storeScheduledTask(updated);
    this.configStore.set(id, updated);

    const task = this.loop.get(id);
    if (task) {
      if ('updateConfig' in task) {
        (task as unknown as { updateConfig(c: TaskConfig): void }).updateConfig(updated);
      }

      if (patch.enabled !== undefined) {
        if (patch.enabled) {
          await task.start();
        } else {
          task.stop();
        }
        await this.emitToggle(id, patch.enabled);
      }
    } else {
      const newTask = createTask(updated);
      this.wireRegionPersistence(newTask, id);
      this.wireWorkflowTemplate(newTask, id);
      this.loop.add(newTask);
      if (patch.enabled !== undefined) {
        await this.emitToggle(id, patch.enabled);
      }
    }

    this.emitStateChange(id, 'updated');
  }

  getStates(): Array<{ config: TaskConfig; state: import('@/types/watcher').WatcherState }> {
    const result: Array<{ config: TaskConfig; state: import('@/types/watcher').WatcherState }> = [];
    for (const task of this.loop.getAll()) {
      const cfg = this.configStore.get(task.id);
      if (!cfg) continue;
      result.push({
        config: cfg,
        state: {
          configId: task.id,
          status: task.state.status as import('@/types/watcher').WatcherState['status'],
          lastCheckAt: task.state.lastCheckAt,
          lastTriggerAt: task.state.lastTriggerAt,
          triggerCount: task.state.triggerCount,
          lastError: task.state.lastError,
          baseline: '',
          queueSize: 0,
          queueItems: [],
          processing: false,
        },
      });
    }
    return result;
  }

  async restore(): Promise<void> {
    const configs = await getAllScheduledTasks();
    let restored = 0;

    // Start the tick loop
    this.loop.start();

    for (const config of configs) {
      this.configStore.set(config.id, config);
      const task = createTask(config);
      this.wireRegionPersistence(task, config.id);
      this.wireWorkflowTemplate(task, config.id);
      this.wireExecutionComplete(task, config.id);

      this.loop.add(task);
      if (config.enabled) {
        await task.start();
        restored++;
      }
    }

    if (restored > 0) {
      appEventBus.emit({
        source: 'scheduler', type: 'manager_restore', level: 'info',
        message: `已恢复 ${restored} 个后台任务`, timestamp: Date.now(),
      });
    }
  }

  private emitStateChange(id: string, action: string): void {
    appEventBus.emit({
      source: 'scheduler', type: 'manager_action', level: 'info',
      message: `Task ${action}: ${id}`, sourceId: id, timestamp: Date.now(),
    });
  }
}

export const scheduledTaskManager = new ScheduledTaskManager();

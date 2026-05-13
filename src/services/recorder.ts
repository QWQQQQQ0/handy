// AutomationRecorder — records tool calls during task automation for skill generation

import type { AutomationStep } from '@/types/skill';

class AutomationRecorder {
  private _recording = false;
  private _steps: AutomationStep[] = [];

  get isRecording() { return this._recording; }
  get steps(): readonly AutomationStep[] { return this._steps; }

  start() {
    this._steps = [];
    this._recording = true;
  }

  recordStep(toolName: string, args: Record<string, unknown>) {
    if (!this._recording) return;
    this._steps.push({
      toolName,
      arguments: { ...args },
      description: `${toolName}(${JSON.stringify(args)})`,
    });
  }

  stop(): AutomationStep[] {
    this._recording = false;
    return [...this._steps];
  }

  cancel() {
    this._recording = false;
    this._steps = [];
  }
}

export const automationRecorder = new AutomationRecorder();

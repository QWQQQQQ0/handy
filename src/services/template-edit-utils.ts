/**
 * 模板步骤编辑工具函数
 *
 * 对 TemplateStep 应用单个字段修改，返回新 step 对象。
 * recorder-mode 和 tasks.tsx 共用此函数，避免 handleEditStepField 重复。
 */
import type { TemplateStep } from '@/types/automation-template';

export function applyStepFieldEdit(
  step: TemplateStep,
  field: string,
  value: unknown,
): TemplateStep {
  switch (field) {
    case 'coordinate_x':
      return {
        ...step,
        target: {
          ...step.target,
          coordinate: { ...step.target?.coordinate, x: value as number | string },
        },
      };
    case 'coordinate_y':
      return {
        ...step,
        target: {
          ...step.target,
          coordinate: { ...step.target?.coordinate, y: value as number | string },
        },
      };
    case 'waitBefore':
      return { ...step, waitBefore: value as number };
    case 'description':
      return { ...step, description: value as string };
    case 'key':
      return { ...step, params: { ...step.params, key: value as string } };
    case 'condition':
      return { ...step, condition: value as string };
    case 'stepId':
      return { ...step, params: { ...step.params, stepId: value as string } };
    case 'prompt':
      return { ...step, params: { ...step.params, prompt: value as string } };
    case 'systemPrompt':
      return { ...step, params: { ...step.params, systemPrompt: value as string } };
    case 'multimodal':
      return { ...step, params: { ...step.params, multimodal: value as boolean } };
    default:
      return step;
  }
}

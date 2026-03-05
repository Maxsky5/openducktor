import type { AgentPromptTemplateId } from "@openducktor/contracts";

export type PromptValidationState = {
  globalErrors: Partial<Record<AgentPromptTemplateId, string>>;
  globalErrorCount: number;
  repoErrorsByPath: Record<string, Partial<Record<AgentPromptTemplateId, string>>>;
  repoErrorCountByPath: Record<string, number>;
  repoTotalErrorCount: number;
  totalErrorCount: number;
};

export const EMPTY_PROMPT_VALIDATION_STATE: PromptValidationState = {
  globalErrors: {},
  globalErrorCount: 0,
  repoErrorsByPath: {},
  repoErrorCountByPath: {},
  repoTotalErrorCount: 0,
  totalErrorCount: 0,
};

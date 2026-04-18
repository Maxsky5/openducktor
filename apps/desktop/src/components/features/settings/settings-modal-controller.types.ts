import type { AgentPromptTemplateId } from "@openducktor/contracts";

export type PromptValidationState = {
  globalErrors: Partial<Record<AgentPromptTemplateId, string>>;
  globalErrorCount: number;
  repoErrorsByWorkspaceId: Record<string, Partial<Record<AgentPromptTemplateId, string>>>;
  repoErrorCountByWorkspaceId: Record<string, number>;
  repoTotalErrorCount: number;
  totalErrorCount: number;
};

export const EMPTY_PROMPT_VALIDATION_STATE: PromptValidationState = {
  globalErrors: {},
  globalErrorCount: 0,
  repoErrorsByWorkspaceId: {},
  repoErrorCountByWorkspaceId: {},
  repoTotalErrorCount: 0,
  totalErrorCount: 0,
};

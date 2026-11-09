import type { PromptValidationErrors } from "./settings-prompt-layers";

/** Error counts count prompts with an error, not layers. */
export type PromptValidationState = {
  globalErrors: PromptValidationErrors;
  globalErrorCount: number;
  repoErrorsByWorkspaceId: Record<string, PromptValidationErrors>;
  repoErrorCountByWorkspaceId: Record<string, number>;
  repoTotalErrorCount: number;
  totalErrorCount: number;
  /** Where the first error is, such as "Fix Kickoff (Bug Triage, System prompts)". */
  firstErrorPlace: string | null;
};

export const EMPTY_PROMPT_VALIDATION_STATE: PromptValidationState = {
  globalErrors: {},
  globalErrorCount: 0,
  repoErrorsByWorkspaceId: {},
  repoErrorCountByWorkspaceId: {},
  repoTotalErrorCount: 0,
  totalErrorCount: 0,
  firstErrorPlace: null,
};

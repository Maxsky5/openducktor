import type { AgentRole } from "@openducktor/core";
import type { WorkflowModelContext } from "./use-agent-studio-page-model-builders";

export type WorkflowHeaderContext = Pick<
  WorkflowModelContext,
  | "workflowStateByRole"
  | "selectedInteractionRole"
  | "workflowSessionByRole"
  | "sessionSelectorAutofocusByValue"
  | "sessionSelectorValue"
  | "sessionSelectorGroups"
  | "sessionCreateOptions"
  | "quickActions"
  | "primaryQuickAction"
>;

export type AgentStudioWorkflowStepSelect = (role: AgentRole, sessionValue: string | null) => void;

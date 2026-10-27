import type { WorkflowModelContext } from "./use-agent-studio-page-model-builders";
import type { BuiltinRoleId as AgentRole } from "@openducktor/workflows";

export type WorkflowHeaderContext = Pick<
  WorkflowModelContext,
  | "workflowStateByRole"
  | "workflowSessionByRole"
  | "sessionSelectorAutofocusByValue"
  | "sessionSelectorValue"
  | "sessionSelectorGroups"
  | "sessionCreateOptions"
  | "quickActions"
  | "primaryQuickAction"
>;

export type AgentStudioWorkflowStepSelect = (role: AgentRole, sessionValue: string | null) => void;

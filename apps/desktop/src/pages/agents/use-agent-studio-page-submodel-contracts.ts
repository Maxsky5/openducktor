import type { AgentRole } from "@openducktor/core";
import type { WorkflowModelContext } from "./use-agent-studio-page-model-builders";

export type WorkflowHeaderContext = Pick<
  WorkflowModelContext,
  | "workflowStateByRole"
  | "selectedInteractionRole"
  | "workflowSessionByRole"
  | "sessionSelectorValue"
  | "sessionSelectorGroups"
  | "sessionCreateOptions"
  | "createSessionDisabled"
>;

export type AgentStudioWorkflowStepSelect = (role: AgentRole, sessionId: string | null) => void;

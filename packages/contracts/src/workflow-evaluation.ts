import type { WorkflowValue } from "./workflow-condition-schemas";

type WorkflowIdentity = {
  workflowId: string;
  definitionRevision: number;
};

export type WorkflowInput = WorkflowIdentity & {
  state: string;
  facts: Record<string, WorkflowValue>;
};

type WorkflowStepProjectionFields = {
  id: string;
  label: string;
  inputs: readonly string[];
  outputs: readonly string[];
  required: boolean;
  available: boolean;
  completed: boolean;
};

export type WorkflowAgentStepProjection = WorkflowStepProjectionFields & {
  kind: "agent";
  roleId: string;
};

export type WorkflowHumanStepProjection = WorkflowStepProjectionFields & {
  kind: "human";
};

export type WorkflowStepProjection = WorkflowAgentStepProjection | WorkflowHumanStepProjection;

type WorkflowEventDecisionFields = WorkflowIdentity & {
  eventId: string;
};

export type WorkflowDecision =
  | (WorkflowEventDecisionFields & {
      kind: "denied";
      state: string;
      reason: "terminal_state" | "source_state";
    })
  | (WorkflowEventDecisionFields & {
      kind: "denied";
      state: string;
      reason: "guard";
      guardId: string;
    })
  | (WorkflowEventDecisionFields & {
      kind: "unchanged";
      state: string;
    })
  | (WorkflowEventDecisionFields & {
      kind: "transition";
      from: string;
      to: string;
    });

import type { WorkflowValue } from "./workflow-condition-schemas";

type WorkflowIdentity = {
  workflowId: string;
  definitionRevision: number;
};

/** Only a present review artifact has a verdict. */
export type WorkflowArtifactState = {
  present: boolean;
  verdict?: string | undefined;
};

export type WorkflowInput = WorkflowIdentity & {
  state: string;
  facts: Record<string, WorkflowValue>;
  artifacts: Record<string, WorkflowArtifactState>;
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

/** The ID types of one workflow definition. A definition with enum IDs gives typed results. */
export type WorkflowIds = {
  state: string;
  event: string;
  action: string;
  step: string;
  role: string;
  signal: string;
  launchAction: string;
};

type WorkflowEventDecisionFields<Ids extends WorkflowIds> = WorkflowIdentity & {
  eventId: Ids["event"];
};

export type WorkflowDecision<Ids extends WorkflowIds = WorkflowIds> =
  | (WorkflowEventDecisionFields<Ids> & {
      kind: "denied";
      state: Ids["state"];
      reason: "terminal_state" | "source_state";
    })
  | (WorkflowEventDecisionFields<Ids> & {
      kind: "denied";
      state: Ids["state"];
      reason: "guard";
      guardId: string;
    })
  | (WorkflowEventDecisionFields<Ids> & {
      kind: "unchanged";
      state: Ids["state"];
    })
  | (WorkflowEventDecisionFields<Ids> & {
      kind: "transition";
      from: Ids["state"];
      to: Ids["state"];
      signal?: Ids["signal"];
      sourceRole?: Ids["role"];
    });

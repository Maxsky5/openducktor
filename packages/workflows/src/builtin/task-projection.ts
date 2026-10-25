import {
  type AgentWorkflowState,
  type AgentWorkflows,
  type WorkflowInput,
} from "@openducktor/contracts";
import { deepFreeze } from "../deep-freeze";
import { BUILTIN_STEPS, builtinWorkflow } from "./definition";
import { qaRejected } from "./definition-conditions";
import { cachedByTaskInput, type BuiltinTask } from "./facts";
import type { BuiltinActionId, BuiltinRoleId } from "./ids";

type BuiltinTaskProjection = {
  readonly availableActions: BuiltinActionId[];
  readonly agentWorkflows: AgentWorkflows;
};

/** Tasks with equal inputs share one frozen projection. */
export const deriveTaskProjection = (task: BuiltinTask): BuiltinTaskProjection =>
  projectionFor(task);

/** Tasks with equal inputs share one frozen result. */
export const deriveAgentWorkflows = (task: BuiltinTask): AgentWorkflows => agentWorkflowsFor(task);

/** A QA-rejected task waiting for Builder rework. */
export const isQaRejectedTask = (task: BuiltinTask | null | undefined): boolean =>
  task != null && qaRejectedFor(task);

const stepRoles: readonly BuiltinRoleId[] = BUILTIN_STEPS.map((step) => step.roleId);

const agentWorkflows = (input: WorkflowInput): AgentWorkflows => {
  const steps = builtinWorkflow.steps(input);
  const workflowFor = (role: BuiltinRoleId): AgentWorkflowState => {
    const step = steps[stepRoles.indexOf(role)];
    if (!step) throw new Error(`The built-in workflow has no step for role ${role}.`);
    return {
      required: step.required,
      canSkip: !step.required,
      available: step.available,
      completed: step.completed,
    };
  };
  return {
    spec: workflowFor("spec"),
    planner: workflowFor("planner"),
    build: workflowFor("build"),
    qa: workflowFor("qa"),
  };
};

const projectionFor = cachedByTaskInput((input): BuiltinTaskProjection =>
  deepFreeze({
    availableActions: builtinWorkflow.availableActions(input),
    agentWorkflows: agentWorkflows(input),
  }),
);
const agentWorkflowsFor = cachedByTaskInput((input) => deepFreeze(agentWorkflows(input)));
const qaRejectedFor = cachedByTaskInput(builtinWorkflow.condition(qaRejected));

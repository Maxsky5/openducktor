import {
  buildWorkflowRail,
  type WorkflowRailStep,
} from "@openducktor/frontend-core/tasks/presentation/workflow-rail";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { TaskSessionGroup } from "./task-sessions-model";

/** One step of the workflow rail of a task. A tap on the step opens its newest session. */
export type TaskWorkflowStep = WorkflowRailStep<AgentSessionIdentity> & {
  /** True while a session of the role works. */
  working: boolean;
};

/** The shared workflow rail of a task, with the newest session of each role. */
export const taskWorkflowSteps = (
  task: TaskCard,
  groups: readonly TaskSessionGroup[],
): TaskWorkflowStep[] => {
  const newestOf = (role: string) => groups.find((group) => group.role === role)?.rows[0] ?? null;
  return buildWorkflowRail(task, (role) => {
    const newest = newestOf(role);
    return { session: newest?.identity ?? null, liveSession: newest?.activityState ?? "none" };
  }).map((step) => ({
    ...step,
    working: step.role ? (newestOf(step.role)?.live ?? false) : false,
  }));
};

import {
  buildWorkflowRail,
  type WorkflowRailStep,
} from "@openducktor/frontend-core/tasks/presentation/workflow-rail";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { TaskSessionGroup } from "./task-sessions-model";

/** One step of the workflow rail of a task. A tap on the step opens its newest session. */
export type TaskWorkflowStep = WorkflowRailStep<AgentSessionIdentity> & {
  /**
   * The mark in place of the role icon while a session of the role works: a spinner while it
   * writes a reply, or a still hourglass while it waits on background tasks.
   */
  liveMark: "spinner" | "hourglass" | null;
};

const liveMarkOf = (row: TaskSessionGroup["rows"][number] | null): TaskWorkflowStep["liveMark"] => {
  if (!row?.live) return null;
  return row.waitingOnBackground ? "hourglass" : "spinner";
};

/** The shared workflow rail of a task, with the newest session of each role. */
export const taskWorkflowSteps = (
  task: TaskCard,
  groups: readonly TaskSessionGroup[],
): TaskWorkflowStep[] => {
  const newestOf = (role: string) => groups.find((group) => group.role === role)?.rows[0] ?? null;
  return buildWorkflowRail(task, (role) => {
    const newest = newestOf(role);
    return {
      session: newest?.identity ?? null,
      liveSession: newest?.activityState ?? "none",
      waitingOnBackground: newest?.waitingOnBackground ?? false,
    };
  }).map((step) => ({
    ...step,
    liveMark: step.role ? liveMarkOf(newestOf(step.role)) : null,
  }));
};

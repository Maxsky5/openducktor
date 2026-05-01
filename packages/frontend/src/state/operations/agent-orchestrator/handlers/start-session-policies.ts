import type { TaskCard } from "@openducktor/contracts";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import type { StartSessionContext, TaskDependencies } from "./start-session.types";

export const resolveStartTask = ({
  ctx,
  task,
}: {
  ctx: StartSessionContext;
  task: TaskDependencies;
}): TaskCard => {
  const resolvedTask = task.taskRef.current.find((entry) => entry.id === ctx.taskId);
  if (!resolvedTask) {
    throw new Error(`Task not found: ${ctx.taskId}`);
  }
  if (!isRoleAvailableForTask(resolvedTask, ctx.role)) {
    throw new Error(unavailableRoleErrorMessage(resolvedTask, ctx.role));
  }
  return resolvedTask;
};

export const resolveReuseValidationError = ({
  matchesQaTarget,
  matchesBuildTarget,
}: {
  matchesQaTarget: boolean;
  matchesBuildTarget: boolean;
}): string | null => {
  if (!matchesQaTarget) {
    return "it does not match the required builder worktree for this QA session";
  }
  if (!matchesBuildTarget) {
    return "it does not match the current builder continuation target";
  }
  return null;
};

import type { ClientFeedback } from "@openducktor/frontend-core/platform/client-feedback";
import type { CoreTaskAction } from "@openducktor/frontend-core/tasks/workflow/core-task-actions";
import type { TaskActionConfirmation } from "@openducktor/frontend-core/tasks/workflow/task-action-destination";
import type { ResolvedTaskCard } from "@openducktor/workflows";

export type TaskConfirmationAction =
  | TaskActionConfirmation
  | CoreTaskAction["confirmation"]
  | "delete";

export const showNoSession = (
  feedback: ClientFeedback,
  task: ResolvedTaskCard,
  role: string,
): void =>
  feedback.show("info", `${task.id} has no ${task.taskWorkflow.role(role).label} session.`, {
    description: "Start a session from the task workflow actions.",
  });

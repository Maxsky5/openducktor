import type {
  AgentRole,
  ExternalTaskSyncEvent,
  NotificationKind,
  NotificationOccurrence,
  TaskCard,
  TaskStatus,
} from "@openducktor/contracts";

type WorkflowNotification = {
  kind: NotificationKind;
  status: string;
  preferredRole?: AgentRole;
};

const workflowNotification = (status: TaskStatus): WorkflowNotification | null => {
  switch (status) {
    case "open":
      return null;
    case "spec_ready":
      return {
        kind: "workflow.spec_ready",
        status: "Task moved to Spec Ready.",
        preferredRole: "spec",
      };
    case "ready_for_dev":
      return {
        kind: "workflow.ready_for_dev",
        status: "Task moved to Ready for Dev.",
        preferredRole: "planner",
      };
    case "in_progress":
      return {
        kind: "workflow.in_progress",
        status: "Task moved to In Progress.",
        preferredRole: "build",
      };
    case "blocked":
      return {
        kind: "workflow.blocked",
        status: "Task moved to Task Blocked.",
        preferredRole: "build",
      };
    case "ai_review":
      return {
        kind: "workflow.ai_review",
        status: "Task moved to AI Review.",
        preferredRole: "build",
      };
    case "human_review":
      return {
        kind: "workflow.human_review",
        status: "Task moved to Human Review.",
        preferredRole: "qa",
      };
    case "closed":
      return { kind: "workflow.closed", status: "Task moved to Closed." };
  }
};

const changedTaskIds = (event: ExternalTaskSyncEvent): readonly string[] =>
  event.kind === "external_task_created" ? [event.taskId] : event.taskIds;

export const createTaskOccurrenceProjector = ({
  repoPath,
  repositoryLabel,
}: {
  repoPath: string;
  repositoryLabel: string;
}) => {
  let baseline = new Map<string, TaskCard>();

  const replaceBaseline = (tasks: readonly TaskCard[]): void => {
    baseline = new Map(tasks.map((task) => [task.id, task]));
  };

  const projectChange = (
    event: ExternalTaskSyncEvent,
    refreshedTasks: readonly TaskCard[],
  ): NotificationOccurrence[] => {
    const refreshedById = new Map(refreshedTasks.map((task) => [task.id, task]));
    const occurrences: NotificationOccurrence[] = [];

    for (const taskId of changedTaskIds(event)) {
      const previous = baseline.get(taskId);
      const current = refreshedById.get(taskId);
      if (!previous || !current || previous.status === current.status) {
        continue;
      }
      const notification = workflowNotification(current.status);
      if (!notification) {
        continue;
      }
      const { kind, status, preferredRole } = notification;
      let navigationTarget: NotificationOccurrence["navigationTarget"];
      if (current.status === "closed") {
        navigationTarget = { type: "kanban_task", repoPath, taskId };
      } else {
        navigationTarget = { type: "agent_studio_task", repoPath, taskId };
        if (preferredRole) navigationTarget.preferredRole = preferredRole;
      }
      const occurrence: NotificationOccurrence = {
        occurrenceId: `${kind}:${repoPath}:${taskId}:${event.eventId}`,
        kind,
        repoPath,
        repositoryLabel,
        task: { id: current.id, title: current.title },
        status,
        navigationTarget,
      };
      if (preferredRole) occurrence.role = preferredRole;
      occurrences.push(occurrence);
    }

    replaceBaseline(refreshedTasks);
    return occurrences;
  };

  return { projectChange, replaceBaseline };
};

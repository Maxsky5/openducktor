import type {
  AgentRole,
  ExternalTaskSyncEvent,
  NotificationKind,
  NotificationOccurrence,
  TaskStatus,
} from "@openducktor/contracts";

type WorkflowNotification = {
  kind: NotificationKind;
  status: string;
  preferredRole?: AgentRole;
};

const workflowNotification = (
  status: TaskStatus,
  sourceRole?: AgentRole,
): WorkflowNotification | null => {
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
        preferredRole: sourceRole ?? "qa",
      };
    case "closed":
      return { kind: "workflow.closed", status: "Task moved to Closed." };
  }
};

export const createTaskOccurrenceProjector = ({
  repoPath,
  repositoryLabel,
}: {
  repoPath: string;
  repositoryLabel: string;
}) => {
  const processedEvents = new Set<string>();

  const projectChange = (
    event: Extract<ExternalTaskSyncEvent, { kind: "tasks_updated" }>,
  ): NotificationOccurrence[] => {
    if (processedEvents.has(event.eventId)) return [];
    processedEvents.add(event.eventId);
    const occurrences: NotificationOccurrence[] = [];

    for (const [
      index,
      { task: current, previousStatus, sourceRole },
    ] of event.statusChanges.entries()) {
      if (previousStatus === current.status) {
        continue;
      }
      const notification = workflowNotification(current.status, sourceRole);
      if (!notification) {
        continue;
      }
      const { kind, status, preferredRole } = notification;
      let navigationTarget: NotificationOccurrence["navigationTarget"];
      if (current.status === "closed") {
        navigationTarget = { type: "kanban_task", repoPath, taskId: current.id };
      } else {
        navigationTarget = { type: "agent_studio_task", repoPath, taskId: current.id };
        if (preferredRole) navigationTarget.preferredRole = preferredRole;
      }
      const occurrence: NotificationOccurrence = {
        occurrenceId: `${kind}:${repoPath}:${current.id}:${event.eventId}:${index}`,
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

    return occurrences;
  };

  return { projectChange };
};

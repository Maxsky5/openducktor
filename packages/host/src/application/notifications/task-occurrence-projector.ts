import type { ExternalTaskSyncEvent, NotificationOccurrence } from "@openducktor/contracts";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";

type TaskProjection = {
  accepted: boolean;
  occurrences: NotificationOccurrence[];
};

export const createTaskOccurrenceProjector = ({
  repoPath,
  repositoryLabel,
  taskWorkflows,
}: {
  repoPath: string;
  repositoryLabel: string;
  taskWorkflows: TaskWorkflowResolver;
}) => {
  let currentRepositoryLabel = repositoryLabel;
  const processedEvents = new Set<string>();

  const projectChange = (
    event: Extract<ExternalTaskSyncEvent, { kind: "tasks_updated" }>,
  ): TaskProjection => {
    if (processedEvents.has(event.eventId)) return { accepted: false, occurrences: [] };
    processedEvents.add(event.eventId);
    const occurrences: NotificationOccurrence[] = [];

    for (const [
      index,
      { task: current, previousStatus, sourceRole },
    ] of event.statusChanges.entries()) {
      if (previousStatus === current.status) {
        continue;
      }
      const notification = taskWorkflows
        .forTask(current)
        .stateNotification(current.status, sourceRole);
      if (!notification) {
        continue;
      }
      const { kind, status, preferredRole } = notification;
      const navigationTarget: NotificationOccurrence["navigationTarget"] = {
        ...notification.navigation,
        repoPath,
        taskId: current.id,
      };
      const occurrence: NotificationOccurrence = {
        occurrenceId: `${kind}:${repoPath}:${current.id}:${event.eventId}:${index}`,
        kind,
        repoPath,
        repositoryLabel: currentRepositoryLabel,
        task: { id: current.id, title: current.title },
        status,
        navigationTarget,
      };
      if (preferredRole) occurrence.role = preferredRole;
      occurrences.push(occurrence);
    }

    return { accepted: true, occurrences };
  };

  return {
    projectChange,
    setRepositoryLabel(label: string) {
      currentRepositoryLabel = label;
    },
  };
};

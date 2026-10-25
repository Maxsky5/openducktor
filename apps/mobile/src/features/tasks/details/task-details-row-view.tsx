import type { TaskCard } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { HeldOutcomesSection } from "@/features/workflow/autopilot/held-outcomes-section";
import { MergedPullRequestNotice } from "@/features/workflow/pull-requests/merged-pull-request-notice";
import { MessageRetryNotices } from "@/features/workflow/start-session/message-retry-notice";
import { DocumentRowView } from "../documents/document-row-view";
import type { CollapsedDetailsSections, DetailsRow } from "./task-details-rows";
import { TaskMetadataSection, TaskSubtasksSection } from "./task-details-section";
import { TaskSessionsSection } from "./task-sessions-section";
import type { TaskSessionGroup } from "./task-sessions-model";
import { TaskWorkLinks } from "./task-work-links";

/** What every row of the task details reads. The view memoizes it. */
export type TaskDetailsRowContext = {
  workspaceId: string;
  task: TaskCard;
  tasks: readonly TaskCard[];
  /** The summary card, when the list shows it. */
  summary: ReactElement;
  sessionGroups: readonly TaskSessionGroup[];
  isLoadingHistory: boolean;
  historyError: string | null;
  sections: CollapsedDetailsSections;
};

/** One row of the task details list: the summary, the notices, a card, or a description row. */
export function TaskDetailsRowView({
  row,
  context,
}: {
  row: DetailsRow;
  context: TaskDetailsRowContext;
}): ReactElement {
  const { workspaceId, task, tasks, sections } = context;
  const { collapsed, toggles } = sections;
  switch (row.kind) {
    case "summary":
      return context.summary;
    case "notices":
      return (
        <View style={styles.notices}>
          <MergedPullRequestNotice taskId={task.id} />
          <MessageRetryNotices taskId={task.id} />
          <HeldOutcomesSection workspaceId={workspaceId} taskId={task.id} />
        </View>
      );
    case "subtasks":
      return (
        <TaskSubtasksSection
          workspaceId={workspaceId}
          task={task}
          tasks={tasks}
          collapsed={collapsed.has("subtasks")}
          onToggle={toggles.subtasks}
        />
      );
    case "sessions":
      return (
        <TaskSessionsSection
          workspaceId={workspaceId}
          taskTitle={task.title}
          groups={context.sessionGroups}
          isLoading={context.isLoadingHistory}
          error={context.historyError}
          collapsed={collapsed.has("sessions")}
          onToggle={toggles.sessions}
        />
      );
    case "work":
      return (
        <TaskWorkLinks
          workspaceId={workspaceId}
          task={task}
          collapsed={collapsed.has("work")}
          onToggle={toggles.work}
        />
      );
    case "metadata":
      return (
        <TaskMetadataSection
          workspaceId={workspaceId}
          task={task}
          tasks={tasks}
          collapsed={collapsed.has("metadata")}
          onToggle={toggles.metadata}
        />
      );
    default:
      return (
        <DocumentRowView
          row={row}
          collapsed={collapsed.has("description")}
          onToggle={toggles.description}
        />
      );
  }
}

const styles = StyleSheet.create((theme) => ({
  notices: { gap: theme.space.sm, paddingTop: theme.space.sm },
}));

import type { PullRequest, TaskCard } from "@openducktor/contracts";
import { formatActiveSessionStopMessage } from "@openducktor/frontend-core/tasks/details/task-cleanup-impact-model";
import {
  isCloseBlocked,
  useTaskCloseChoice,
  useTaskCloseImpact,
  useTaskCloseLoader,
} from "@openducktor/frontend-core/tasks/details/use-task-close-impact";
import {
  formatMergedAt,
  MERGED_PULL_REQUEST_CONFIRM_COPY as COPY,
} from "@openducktor/frontend-core/tasks/pull-requests/merged-pull-request-confirm-copy";
import type { CloseTaskOptions } from "@openducktor/frontend-core/types/task-close";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { TaskCleanupChoice } from "../close/task-close-content";
import { TaskConfirmFrame } from "../confirm/task-confirm-view";
import { PullRequestLinkButton } from "./pull-request-link-button";

/** The merged pull request that a confirmation links, with the task that the link closes. */
export type MergedPullRequestLink = {
  taskId: string;
  taskTitle: string | null;
  taskRemoveWorktreeOnClose: TaskCard["removeWorktreeOnClose"];
  pullRequest: PullRequest;
};

/**
 * The confirmation of Link and Mark Done, as the desktop one: the task, the pull request, what the
 * link stops, and the cleanup choice of the close.
 */
export function MergedPullRequestConfirm({
  visible,
  link,
  linking,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  link: MergedPullRequestLink;
  linking: boolean;
  onCancel: () => void;
  onConfirm: (options: CloseTaskOptions) => void;
}): ReactElement {
  const { taskId, taskTitle, pullRequest } = link;
  // Each confirmation starts from the task override or the global setting.
  const { removeWorktree, onRemoveWorktreeChange } = useTaskCloseChoice(
    link.taskRemoveWorktreeOnClose,
  );
  // The link stops the task terminals and live sessions, as a close does.
  const impact = useTaskCloseImpact({
    task: { id: taskId, title: taskTitle ?? "" },
    enabled: visible,
  });
  const isPreparing = useTaskCloseLoader(impact, removeWorktree);
  return (
    <TaskConfirmFrame
      visible={visible}
      title={COPY.title}
      tone="warning"
      confirm={{
        label: linking ? COPY.confirmPendingLabel : COPY.confirmLabel,
        isBusy: linking,
        disabled: isPreparing || linking || isCloseBlocked(impact, removeWorktree),
      }}
      isPending={linking}
      loading={isPreparing}
      intro={
        <View style={styles.group}>
          <Text variant="body" style={styles.muted}>
            {COPY.description}
          </Text>
          {taskTitle ? (
            <Text variant="body" weight="medium" numberOfLines={2} selectable>
              {taskTitle}
            </Text>
          ) : null}
          <Text variant="mono" selectable style={styles.muted}>
            {taskId}
          </Text>
          <PullRequestLinkButton pullRequest={pullRequest} />
        </View>
      }
      // The link operation reports its failure in a toast, and the confirmation stays.
      failure={null}
      icon="circle-check-big"
      onCancel={onCancel}
      onConfirm={() => {
        if (removeWorktree !== null) onConfirm({ removeWorktree });
      }}
    >
      <View style={styles.group}>
        {pullRequest.mergedAt ? (
          <Text variant="footnote" style={styles.muted}>
            {`${COPY.mergedAtHeading}: ${formatMergedAt(pullRequest.mergedAt)}`}
          </Text>
        ) : null}
      </View>
      <Callout
        tone="info"
        size="sm"
        title={COPY.nextStepsHeading}
        message={COPY.nextSteps}
        // A failed session read shows in the read error row, with a retry.
        detail={
          impact.activeSessionCount
            ? formatActiveSessionStopMessage(impact.activeSessionCount, "close")
            : null
        }
      />
      <TaskCleanupChoice
        impact={impact}
        removeWorktree={removeWorktree}
        onRemoveWorktreeChange={onRemoveWorktreeChange}
        disabled={linking}
      />
    </TaskConfirmFrame>
  );
}

const styles = StyleSheet.create((theme) => ({
  muted: { color: theme.desktop.mutedForeground },
  group: { gap: 2 },
}));

import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  formatMergedAt,
  MERGED_PULL_REQUEST_CONFIRM_COPY as COPY,
} from "@openducktor/frontend-core/tasks/pull-requests/merged-pull-request-confirm-copy";
import { pullRequestLabel } from "@openducktor/frontend-core/tasks/pull-requests/pull-request-presentation";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "@/ui/button";
import { useConfirm } from "@/ui/confirm-dialog";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { PullRequestLinkButton } from "./pull-request-link-button";

/** The confirm label of the desktop copy, in the title case of mobile buttons. */
const LINK_LABEL = "Link and Mark Done";

/**
 * The merged pull request that Detect PR found in the selected workspace, as a compact notice. It
 * names the task that it closes. Link and Mark Done asks for confirmation first, because it also
 * removes the builder worktree and branch. The board and the task details show it.
 */
export function MergedPullRequestNotice({ taskId }: { taskId?: string }): ReactElement | null {
  const {
    pendingMergedPullRequest,
    linkingMergedPullRequestTaskId,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
  } = useRequiredContext(TasksStateContext, "MergedPullRequestNotice");
  const theme = useAppTheme();
  const confirm = useConfirm();
  if (!pendingMergedPullRequest) return null;
  if (taskId !== undefined && pendingMergedPullRequest.taskId !== taskId) return null;
  const { pullRequest, taskTitle } = pendingMergedPullRequest;
  const linking = pendingMergedPullRequest.taskId === linkingMergedPullRequestTaskId;
  const task = taskTitle
    ? `${pendingMergedPullRequest.taskId} · ${taskTitle}`
    : pendingMergedPullRequest.taskId;
  const link = () => {
    void confirm({
      title: COPY.title,
      message: `${COPY.description}\n\n${COPY.nextSteps}`,
      confirmLabel: LINK_LABEL,
    }).then((confirmed) => {
      if (confirmed) void linkMergedPullRequest();
    });
  };
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <Icon name="git-merge" size={18} colorValue={theme.desktop.pendingMuted} />
      <View style={styles.body}>
        <Text variant="subhead" weight="semibold" accessibilityRole="header" style={styles.title}>
          {COPY.title}
        </Text>
        <Text variant="footnote" tone="secondary" numberOfLines={2} selectable>
          {task}
        </Text>
        <View style={styles.pullRequest}>
          <PullRequestLinkButton pullRequest={pullRequest} />
          {pullRequest.mergedAt ? (
            <Text variant="footnote" tone="secondary" numberOfLines={1}>
              {formatMergedAt(pullRequest.mergedAt)}
            </Text>
          ) : null}
        </View>
        <View style={styles.actions}>
          <Button
            label={linking ? COPY.confirmPendingLabel : LINK_LABEL}
            size="sm"
            variant="tinted"
            icon="check"
            loading={linking}
            command
            accessibilityLabel={`${COPY.confirmLabel}: ${pullRequestLabel(pullRequest)} for ${pendingMergedPullRequest.taskId}`}
            onPress={link}
          />
          <Button
            label={COPY.cancelLabel}
            size="sm"
            variant="plain"
            disabled={linking}
            onPress={cancelLinkMergedPullRequest}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.md,
    marginHorizontal: theme.layout.screenPadding,
    marginTop: theme.space.sm,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.pendingBorder,
    backgroundColor: theme.desktop.pendingSurface,
  },
  body: { flex: 1, gap: 2 },
  title: { color: theme.desktop.pendingSurfaceForeground },
  pullRequest: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.space.sm,
  },
  actions: { flexDirection: "row", gap: theme.space.sm, paddingTop: theme.space.xs },
}));

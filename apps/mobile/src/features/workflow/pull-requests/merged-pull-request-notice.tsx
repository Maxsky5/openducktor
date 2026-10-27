import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  formatMergedAt,
  MERGED_PULL_REQUEST_CONFIRM_COPY as COPY,
} from "@openducktor/frontend-core/tasks/pull-requests/merged-pull-request-confirm-copy";
import { pullRequestLabel } from "@openducktor/frontend-core/tasks/pull-requests/pull-request-presentation";
import { type ReactElement, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "@/ui/button";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import {
  MergedPullRequestConfirm,
  type MergedPullRequestLink,
} from "./merged-pull-request-confirm";
import { titleCase } from "../start-session/start-form-model";
import { PullRequestLinkButton } from "./pull-request-link-button";

/** The confirm label of the desktop copy, in the title case of mobile buttons. */
const LINK_LABEL = titleCase(COPY.confirmLabel);

/**
 * The merged pull request that Detect PR found in the selected workspace, as a compact notice. It
 * names the task that it closes. Link and Mark Done asks for confirmation first, because it also
 * stops the task sessions, and the confirmation has the cleanup choice of the close. The board and
 * the task details show it.
 */
export function MergedPullRequestNotice({ taskId }: { taskId?: string }): ReactElement | null {
  const {
    pendingMergedPullRequest,
    linkingMergedPullRequestTaskId,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
  } = useRequiredContext(TasksStateContext, "MergedPullRequestNotice");
  const theme = useAppTheme();
  // The confirmation keeps the link that it shows while it closes, also after the link ends.
  const [confirmation, setConfirmation] = useState<{
    id: number;
    link: MergedPullRequestLink;
    open: boolean;
  } | null>(null);
  const shown =
    pendingMergedPullRequest && (taskId === undefined || pendingMergedPullRequest.taskId === taskId)
      ? pendingMergedPullRequest
      : null;
  const linking = shown !== null && shown.taskId === linkingMergedPullRequestTaskId;
  const confirm = confirmation ? (
    <MergedPullRequestConfirm
      key={confirmation.id}
      visible={confirmation.open && shown?.taskId === confirmation.link.taskId}
      link={confirmation.link}
      linking={linking}
      onCancel={() => setConfirmation({ ...confirmation, open: false })}
      onConfirm={(options) => {
        void linkMergedPullRequest(options);
      }}
    />
  ) : null;
  if (!shown) return confirm;
  const { pullRequest, taskTitle } = shown;
  const task = taskTitle ? `${shown.taskId} · ${taskTitle}` : shown.taskId;
  return (
    <>
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
              disabled={linking}
              command
              accessibilityLabel={`${COPY.confirmLabel}: ${pullRequestLabel(pullRequest)} for ${shown.taskId}`}
              onPress={() =>
                setConfirmation({ id: (confirmation?.id ?? 0) + 1, link: shown, open: true })
              }
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
      {confirm}
    </>
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

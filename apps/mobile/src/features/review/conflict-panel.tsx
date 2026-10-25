import {
  getGitConflictCopy,
  gitConflictDescription,
} from "@openducktor/frontend-core/git/conflicts/conflict-copy";
import { createGitConflictActionsModel } from "@openducktor/frontend-core/git/conflicts/git-conflict-actions-model";
import type { GitConflict } from "@openducktor/frontend-core/git/contracts";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "@/ui/button";
import { useConfirm } from "@/ui/confirm-dialog";
import { Icon } from "@/ui/icon";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";
import type { GitConflictActions } from "./use-git-conflict-actions";

const conflictedFilesLabel = (count: number): string =>
  `${count} conflicted ${count === 1 ? "file" : "files"}`;

/**
 * The Git Conflict of the Changes view, as the desktop conflict strip: the operation, the
 * conflicted file count, and the description, with Abort and Ask the agent to resolve. The
 * Conflicts group of the list shows every conflicted file.
 */
export function ConflictPanel({
  conflict,
  actions,
  recipientLabel,
}: {
  conflict: GitConflict;
  actions: GitConflictActions;
  recipientLabel: "Builder" | "agent";
}): ReactElement {
  const theme = useAppTheme();
  const confirm = useConfirm();
  const copy = getGitConflictCopy(conflict.operation);
  const model = createGitConflictActionsModel({
    operation: conflict.operation,
    isHandlingConflict: actions.action !== null,
    conflictAction: actions.action,
    onAbort: () => {
      void confirm({
        title: copy.abortLabel,
        message: `This stops the ${copy.operationLabel} and puts the branch back as it was before it.`,
        confirmLabel: copy.abortLabel,
        destructive: true,
      }).then((confirmed) => {
        if (confirmed) void actions.abort();
      });
    },
    onAsk: () => {
      void confirm({
        title: `Ask the ${recipientLabel} to resolve the conflict?`,
        message: actions.askDescription,
        confirmLabel: "Send Request",
      }).then((confirmed) => {
        if (confirmed) void actions.askAgent();
      });
    },
    recipientLabel,
    blockedReason: actions.askBlockedReason,
  });
  const { help } = model;
  useAnnounce(help?.blockedReason);
  const count = conflict.conflictedFiles.length;
  return (
    <>
      <View style={styles.strip} accessibilityRole="summary">
        <View style={styles.header}>
          <View style={styles.iconTile}>
            <Icon name="triangle-alert" size={16} colorValue={theme.desktop.warningMuted} />
          </View>
          <View style={styles.copy}>
            <View style={styles.titleLine}>
              <Text variant="callout" weight="semibold" style={styles.title}>
                {copy.inProgressLabel}
              </Text>
              <View style={styles.countBadge}>
                <Text variant="caption1" weight="semibold" tabular style={styles.countText}>
                  {conflictedFilesLabel(count)}
                </Text>
              </View>
            </View>
            <Text variant="subhead" selectable style={styles.description}>
              {gitConflictDescription(conflict)}
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Button
            label={model.abort.label}
            icon="rotate-ccw"
            variant="outline"
            size="sm"
            command
            loading={model.abort.isPending}
            disabled={model.abort.isDisabled}
            onPress={model.abort.onClick}
          />
          {help ? (
            <Button
              label={help.label}
              icon="sparkles"
              size="sm"
              variant="filled"
              command
              loading={help.isPending}
              disabled={help.isDisabled}
              onPress={help.onClick}
              accessibilityHint={help.blockedReason ?? actions.askDescription}
            />
          ) : null}
        </View>
        {help?.blockedReason ? (
          <Text variant="subhead" style={styles.description} accessibilityLiveRegion="polite">
            {help.blockedReason}
          </Text>
        ) : null}
      </View>
      {actions.notice ? (
        <View style={styles.notice}>
          <Callout
            tone={actions.notice.tone}
            title={actions.notice.title}
            message={actions.notice.message}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  strip: {
    gap: theme.space.md,
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: theme.space.md,
    borderTopWidth: theme.hairline,
    borderBottomWidth: theme.hairline,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.panelFill,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.md },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: theme.desktop.warningBorder,
    backgroundColor: theme.desktop.warningSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  titleLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.space.sm },
  title: { color: theme.desktop.foreground },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.desktop.warningBorder,
    backgroundColor: theme.desktop.warningSurface,
  },
  countText: { color: theme.desktop.warningMuted },
  description: { color: theme.desktop.mutedForeground },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.space.sm,
  },
  notice: { paddingHorizontal: theme.layout.screenPadding },
}));

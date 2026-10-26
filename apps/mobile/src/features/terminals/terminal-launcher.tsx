import type { RepoAction } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { repoConfigQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import {
  MISSING_DEFAULT_ACTION_MESSAGE,
  splitRepoActions,
} from "@openducktor/frontend-core/terminals/repo-actions";
import type { TerminalSessionsModel } from "@openducktor/frontend-core/terminals/use-terminals";
import { useQuery } from "@tanstack/react-query";
import { type ReactElement, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { useCommandGate } from "@/host-session/active-session-context";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon, type IconName } from "@/ui/icon";
import { Callout } from "@/ui/callout";
import { SectionFooter, SectionHeader } from "@/ui/surfaces";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { REPO_ACTION_ICONS } from "./repo-action-icons";

/**
 * One start choice, as the desktop New tab launcher card: an icon tile, a label, one line that
 * tells what it does, and an arrow. A choice that cannot run shows the reason as its line.
 */
function LauncherCard({
  icon,
  label,
  description,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  onPress,
}: {
  icon: IconName;
  label: string;
  description: string;
  disabled: boolean;
  accessibilityLabel: string;
  accessibilityHint: string;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="scale"
      onPress={onPress}
      disabled={disabled}
      radius={theme.radius.lg}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={styles.card}
    >
      <View style={styles.tile}>
        <Icon name={icon} size={20} colorValue={theme.desktop.mutedForeground} />
      </View>
      <View style={styles.copy}>
        <Text weight="medium" numberOfLines={1}>
          {label}
        </Text>
        <Text variant="subhead" numberOfLines={2} style={styles.description}>
          {description}
        </Text>
      </View>
      <Icon name="arrow-right" size={16} colorValue={theme.desktop.mutedForeground} />
    </Touchable>
  );
}

/**
 * The start choices of a task or chat: a new shell, then each repository action, default first.
 * Each choice starts a terminal on the host. A blocked start shows its reason on every card.
 */
export function TerminalLauncher({
  owner,
  model,
  onStart,
}: {
  owner: WorkOwner;
  model: TerminalSessionsModel;
  onStart: (action?: RepoAction) => void;
}): ReactElement {
  const gate = useCommandGate();
  const repoConfig = useQuery(repoConfigQueryOptions(owner.workspace.workspaceId));
  const repoActions = repoConfig.data?.actions;
  const split = useMemo(() => (repoActions ? splitRepoActions(repoActions) : null), [repoActions]);
  const blocked = model.startBlockedReason;
  // The discovery failure shows with its own Retry above the list.
  const blockedText = model.discoveryError === null ? blocked : null;
  const disabled = blocked !== null || !gate.open;
  const actions = split?.kind === "ready" ? [split.defaultAction, ...split.otherActions] : [];
  return (
    <View>
      <SectionHeader title="Start" />
      <View style={styles.cards}>
        <LauncherCard
          icon="square-terminal"
          label="New terminal"
          description={blockedText ?? "Run commands in a new shell."}
          disabled={disabled}
          accessibilityLabel="New terminal"
          accessibilityHint={blocked ?? "Starts a shell in the working directory."}
          onPress={() => onStart()}
        />
      </View>
      {actions.length > 0 ? (
        <>
          <SectionHeader title="Repository actions" />
          <View style={styles.cards}>
            {actions.map((action) => (
              <LauncherCard
                key={action.id}
                icon={REPO_ACTION_ICONS[action.icon]}
                label={action.name}
                description={
                  blockedText ??
                  (split?.kind === "ready" && action.id === split.defaultAction.id
                    ? "Default action. Runs in a new terminal."
                    : "Runs in a new terminal.")
                }
                disabled={disabled}
                accessibilityLabel={`Run ${action.name}`}
                accessibilityHint={blocked ?? "Runs the action in a new terminal."}
                onPress={() => onStart(action)}
              />
            ))}
          </View>
        </>
      ) : null}
      {split?.kind === "empty" ? (
        <SectionFooter text="Add repository actions in the repository settings on the host." />
      ) : null}
      {repoConfig.error ? (
        <View style={styles.notice}>
          <Callout
            tone="warning"
            title="Could not load repository actions"
            message={errorMessage(repoConfig.error)}
          />
        </View>
      ) : null}
      {split?.kind === "missing_default" ? (
        <View style={styles.notice}>
          <Callout
            tone="warning"
            title="Fix repository actions"
            message={MISSING_DEFAULT_ACTION_MESSAGE}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  cards: { gap: theme.space.sm, paddingHorizontal: theme.layout.screenPadding },
  card: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: theme.space.lg,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.surface,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.desktop.muted,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  description: { color: theme.desktop.mutedForeground },
  notice: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.space.md },
}));

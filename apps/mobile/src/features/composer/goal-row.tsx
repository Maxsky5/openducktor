import type { AgentSessionGoalControlAction, AgentSessionGoalStatus } from "@openducktor/contracts";
import { AGENT_SESSION_GOAL_ACTION_LABELS } from "@openducktor/frontend-core/sessions/goals/agent-session-goal-row";
import type { AgentSessionGoalRowModel } from "@openducktor/frontend-core/sessions/goals/use-agent-session-goal-row";
import { type ReactElement, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { type AppTheme, touchSlop } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

/** The desktop `-mb-1.5`: the row tucks under the composer card. */
const TUCK = 6;
const LINE_HEIGHT = 20;

const ACTION_ICONS = {
  pause: "pause",
  resume: "play",
  clear: "x",
} satisfies Record<AgentSessionGoalControlAction, IconName>;

const statusColor = (theme: AppTheme, status: AgentSessionGoalStatus): string => {
  switch (status) {
    case "active":
    case "complete":
      return theme.desktop.successMuted;
    case "paused":
      return theme.desktop.warningMuted;
    case "blocked":
    case "limit_reached":
      return theme.desktop.destructiveMuted;
    case "waiting_for_message":
      return theme.desktop.infoMuted;
    case "ended":
      return theme.desktop.mutedForeground;
  }
};

/**
 * The goal of the session on the top edge of the composer, as the desktop goal row: the status,
 * the objective on one line, and the actions of the runtime. A press on the objective shows all
 * of it.
 */
export function GoalRow({ model }: { model: AgentSessionGoalRowModel }): ReactElement {
  const theme = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.row} accessibilityLabel="Goal">
      <View style={styles.line}>
        <View style={styles.glyph}>
          <Icon name="target" size={14} colorValue={theme.desktop.mutedForeground} />
        </View>
        <Text style={styles.label}>Goal</Text>
        <Text style={[styles.status, { color: statusColor(theme, model.status) }]}>
          {model.statusLabel}
        </Text>
        <Touchable
          feedback="opacity"
          style={styles.objective}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Show less of the goal" : "Show the whole goal"}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((current) => !current)}
        >
          <Text numberOfLines={expanded ? undefined : 1} style={styles.objectiveText}>
            {model.objective}
          </Text>
        </Touchable>
        <View style={styles.actions}>
          {model.actions.map((action) => (
            <GoalActionButton
              key={action}
              action={action}
              pending={model.pendingAction === action}
              disabled={model.pendingAction !== null}
              onPress={() => model.onAction(action)}
            />
          ))}
        </View>
      </View>
      {model.detail ? (
        <Text variant="footnote" style={styles.detail}>
          {model.detail}
        </Text>
      ) : null}
      {model.error ? (
        <Text variant="footnote" selectable accessibilityRole="alert" style={styles.error}>
          {model.error}
        </Text>
      ) : null}
    </View>
  );
}

function GoalActionButton({
  action,
  pending,
  disabled,
  onPress,
}: {
  action: AgentSessionGoalControlAction;
  pending: boolean;
  disabled: boolean;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="opacity"
      onPress={onPress}
      disabled={disabled}
      hitSlop={touchSlop(24)}
      accessibilityRole="button"
      accessibilityLabel={`${AGENT_SESSION_GOAL_ACTION_LABELS[action]} goal`}
      accessibilityState={{ disabled, busy: pending }}
      style={styles.button}
    >
      {pending ? (
        <LoaderSpinner size={14} color={theme.desktop.mutedForeground} />
      ) : (
        <Icon name={ACTION_ICONS[action]} size={14} colorValue={theme.desktop.mutedForeground} />
      )}
    </Touchable>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  // The desktop row: `mx-3 -mb-1.5 rounded-t-xl border border-b-0 border-input bg-chat-surface
  // px-3 pt-2 pb-3.5 text-[13px] leading-5 text-muted-foreground shadow-xs`.
  row: {
    marginHorizontal: theme.space.md,
    marginBottom: -TUCK,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.sm + TUCK,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.chatSurface,
    boxShadow: theme.shadows.card,
  },
  line: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  glyph: { height: LINE_HEIGHT * rt.fontScale, justifyContent: "center" },
  label: {
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
    fontSize: 13,
    lineHeight: LINE_HEIGHT,
    color: theme.desktop.foreground,
  },
  status: {
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
    fontSize: 13,
    lineHeight: LINE_HEIGHT,
  },
  objective: { flex: 1, minWidth: 0 },
  objectiveText: {
    fontFamily: theme.fonts.sans.regular,
    fontWeight: "400",
    fontSize: 13,
    lineHeight: LINE_HEIGHT,
    color: theme.desktop.foreground,
  },
  // The gaps hold the touch areas of the 24-point actions, so a tap never runs its neighbor.
  actions: { flexDirection: "row", alignItems: "center", gap: 2 * touchSlop(24) },
  button: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
  },
  detail: { marginTop: 2, paddingLeft: 22, color: theme.desktop.mutedForeground },
  error: { marginTop: 2, paddingLeft: 22, color: theme.desktop.destructive },
}));

import type { AgentSessionGoalControlAction } from "@openducktor/contracts";
import { AGENT_SESSION_GOAL_ACTION_LABELS } from "@openducktor/frontend-core/sessions/goals/agent-session-goal-row";
import type { AgentSessionGoalRowModel } from "@openducktor/frontend-core/sessions/goals/use-agent-session-goal-row";
import { type ReactElement, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { touchSlop } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { goalActionsOpen, goalToneColor, pressGoalAction } from "./goal-row-state";
import { CardIconButton } from "./card-icon-button";
import {
  COMPOSER_EDGE_LINE_HEIGHT as LINE_HEIGHT,
  composerEdgeCardStyle,
  composerEdgeTextStyle,
} from "./composer-edge-card";

const ACTION_ICONS = {
  pause: "pause",
  resume: "play",
  clear: "x",
} satisfies Record<AgentSessionGoalControlAction, IconName>;

/**
 * The goal of the session on the top edge of the composer, as the desktop goal row: the status,
 * the objective on one line, and the actions of the runtime. A press on the objective shows all
 * of it. The actions send host commands, so they wait for the command gate, as the queue does.
 */
export function GoalRow({
  model,
  commandsOpen,
}: {
  model: AgentSessionGoalRowModel;
  commandsOpen: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.row} accessibilityLabel="Goal">
      <View style={styles.line}>
        <View style={styles.glyph}>
          <Icon name="target" size={14} colorValue={theme.desktop.mutedForeground} />
        </View>
        <Text style={styles.label}>Goal</Text>
        <Text style={[styles.status, { color: goalToneColor(theme, model.tone) }]}>
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
            <CardIconButton
              key={action}
              icon={ACTION_ICONS[action]}
              accessibilityLabel={`${AGENT_SESSION_GOAL_ACTION_LABELS[action]} goal`}
              pending={model.pendingAction === action}
              disabled={!goalActionsOpen(model, commandsOpen)}
              onPress={() => pressGoalAction(model, commandsOpen, action)}
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

const styles = StyleSheet.create((theme, rt) => ({
  row: composerEdgeCardStyle(theme),
  line: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  glyph: { height: LINE_HEIGHT * rt.fontScale, justifyContent: "center" },
  label: composerEdgeTextStyle(theme, "medium", theme.desktop.foreground),
  status: {
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
    fontSize: 13,
    lineHeight: LINE_HEIGHT,
  },
  objective: { flex: 1, minWidth: 0 },
  objectiveText: composerEdgeTextStyle(theme, "regular", theme.desktop.foreground),
  // The gaps hold the touch areas of the 24-point actions, so a tap never runs its neighbor.
  actions: { flexDirection: "row", alignItems: "center", gap: 2 * touchSlop(24) },
  detail: { marginTop: 2, paddingLeft: 22, color: theme.desktop.mutedForeground },
  error: { marginTop: 2, paddingLeft: 22, color: theme.desktop.destructive },
}));

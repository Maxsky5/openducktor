import type { AgentSessionTodoItem } from "@openducktor/core";
import {
  getActionableSessionTodo,
  getVisibleSessionTodos,
} from "@openducktor/frontend-core/sessions/session-view/agent-session-todo-panel-model";
import { memo, type ReactElement, useCallback, useMemo, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { runtimeAccentColor } from "@/theme/runtime-accent";
import { motion, sansWeight } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { useSessionTarget } from "../session-target";
import { useSessionFacts } from "../use-session-facts";
import { useSessionRuntimeInfo } from "../use-session-runtime-info";
import { type SessionPanelVariant, SidePanelSection } from "./panel-frames";

export type { SessionPanelVariant } from "./panel-frames";

const STATUS_TEXT = {
  completed: "done",
  in_progress: "in progress",
  pending: "to do",
  cancelled: "cancelled",
} satisfies Record<AgentSessionTodoItem["status"], string>;

/** The expanded list takes at most this share of the window height, as the desktop `40vh`. */
const LIST_HEIGHT_SHARE = 0.4;

const LIST_ENTERING = FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System);
const LIST_EXITING = FadeOut.duration(motion.press).reduceMotion(ReduceMotion.System);

/** The Session Todos that the panel lists. */
export const useVisibleSessionTodos = () => {
  const { todos } = useSessionRuntimeInfo();
  return useMemo(() => getVisibleSessionTodos(todos), [todos]);
};

/**
 * Session Todos when the runtime reports them, as the desktop `AgentSessionTodoPanel`. On a phone
 * the panel sits on the composer: a header with the count and the current todo that opens the
 * whole list, with the runtime accent on its left edge. The wide side panel shows the whole list.
 */
export function SessionTodosPanel({
  variant,
}: {
  variant: SessionPanelVariant;
}): ReactElement | null {
  const facts = useSessionFacts();
  const visible = useVisibleSessionTodos();
  const actionable = getActionableSessionTodo(visible);
  // As on desktop, the panel leaves when no todo needs work.
  if (visible.length === 0 || (variant === "inline" && !actionable)) return null;
  const completed = visible.filter((todo) => todo.status === "completed").length;
  const accessibilityLabel = `Todo, ${completed} of ${visible.length} done${
    actionable ? `. Current: ${actionable.content}` : ""
  }`;
  const list = visible.map((todo) => (
    <TodoRow key={todo.id} todo={todo} working={facts.isWorking} />
  ));

  if (variant === "side") {
    return (
      <SidePanelSection
        title="Todo"
        count={`${completed}/${visible.length}`}
        accessibilityLabel={accessibilityLabel}
        style={styles.side}
      >
        {list}
      </SidePanelSection>
    );
  }
  return (
    <InlineTodoPanel
      accessibilityLabel={accessibilityLabel}
      count={`${completed}/${visible.length}`}
      actionable={actionable}
      working={facts.isWorking}
    >
      {list}
    </InlineTodoPanel>
  );
}

function InlineTodoPanel({
  accessibilityLabel,
  count,
  actionable,
  working,
  children,
}: {
  accessibilityLabel: string;
  count: string;
  actionable: AgentSessionTodoItem | null;
  working: boolean;
  children: ReactElement[];
}): ReactElement {
  const theme = useAppTheme();
  const { identity } = useSessionTarget();
  const { height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const accent = runtimeAccentColor(theme, identity.runtimeKind);
  return (
    <View style={styles.panelWrap}>
      <View style={[styles.panel, { borderLeftColor: accent }]}>
        <Touchable
          feedback="highlight"
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={expanded ? "Collapses the todo list." : "Expands the todo list."}
          accessibilityState={{ expanded }}
          style={styles.header}
        >
          <View style={styles.headerTitle}>
            <Icon name="list-todo" size={16} colorValue={theme.desktop.mutedForeground} />
            <Text variant="subhead" weight="semibold" style={styles.foreground}>
              Todo
            </Text>
            <Text tabular style={styles.count}>
              {count}
            </Text>
          </View>
          {!expanded && actionable ? (
            <View style={styles.current}>
              <TodoStatusIcon status={actionable.status} working={working} />
              <Text variant="callout" numberOfLines={1} style={styles.currentText}>
                {actionable.content}
              </Text>
            </View>
          ) : (
            <View style={styles.spacer} />
          )}
          <Icon
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            colorValue={theme.desktop.mutedForeground}
          />
        </Touchable>
        {expanded ? (
          <Animated.View entering={LIST_ENTERING} exiting={LIST_EXITING} style={styles.listWrap}>
            <ScrollView
              style={{ maxHeight: Math.round(height * LIST_HEIGHT_SHARE) }}
              contentContainerStyle={styles.list}
              nestedScrollEnabled
            >
              {children}
            </ScrollView>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

/** The desktop todo status icon: a check when done, the running loader while the agent works. */
function TodoStatusIcon({
  status,
  working,
}: {
  status: AgentSessionTodoItem["status"];
  working: boolean;
}): ReactElement {
  const theme = useAppTheme();
  if (status === "completed") {
    return <Icon name="circle-check" size={14} colorValue={theme.desktop.successAccent} />;
  }
  if (status === "in_progress") {
    return working ? (
      <LoaderSpinner size={14} color={theme.desktop.statusRunning} />
    ) : (
      <Icon name="circle-dot-dashed" size={14} colorValue={theme.desktop.statusRunning} />
    );
  }
  return <Icon name="circle" size={14} colorValue={theme.desktop.mutedForeground} />;
}

const TodoRow = memo(function TodoRow({
  todo,
  working,
}: {
  todo: AgentSessionTodoItem;
  working: boolean;
}): ReactElement {
  styles.useVariants({ status: todo.status });
  return (
    <View
      style={styles.item}
      accessible
      accessibilityLabel={`${todo.content}, ${STATUS_TEXT[todo.status]}`}
    >
      <View style={styles.itemIcon}>
        <TodoStatusIcon status={todo.status} working={working} />
      </View>
      <Text variant="callout" style={styles.itemText}>
        {todo.content}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  side: { maxHeight: "50%" },
  panelWrap: { paddingHorizontal: theme.space.md, paddingTop: theme.space.sm },
  // `border border-input border-b-0 border-l-0 bg-card` with the runtime accent `border-l-4`.
  panel: {
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderLeftWidth: 4,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
  },
  header: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  headerTitle: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  foreground: { color: theme.desktop.foreground },
  count: {
    ...sansWeight("medium"),
    fontSize: 11,
    lineHeight: 14,
    color: theme.desktop.mutedForeground,
  },
  current: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingLeft: theme.space.md,
    borderLeftWidth: 1,
    borderLeftColor: withAlpha(theme.desktop.border, 0.7),
  },
  currentText: { flex: 1, minWidth: 0, color: theme.desktop.foreground },
  spacer: { flex: 1 },
  listWrap: { borderTopWidth: 1, borderTopColor: withAlpha(theme.desktop.input, 0.8) },
  list: {
    gap: theme.space.xs,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.md,
  },
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.sm,
    padding: theme.space.xs,
  },
  // Centers the icon on the first 20-point text line.
  itemIcon: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  itemText: {
    flex: 1,
    minWidth: 0,
    variants: {
      status: {
        in_progress: { ...sansWeight("medium"), color: theme.desktop.foreground },
        completed: { color: theme.desktop.mutedForeground, textDecorationLine: "line-through" },
        pending: { color: theme.desktop.foreground },
        cancelled: { color: theme.desktop.foreground },
      },
    },
  },
}));

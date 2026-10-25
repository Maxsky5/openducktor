import type { AgentRole } from "@openducktor/core";
import { useMinuteClockLabel } from "@openducktor/frontend-core/lib/relative-time";
import { useSessionUnread } from "@openducktor/frontend-core/sessions/navigation/session-read-state";
import {
  sessionEntryShortTime,
  ATTENTION_REASON_LABELS,
  visibleAttentionReasons,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-entry-labels";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { memo, type ReactElement, useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  type AccessibilityActionEvent,
  type DimensionValue,
  View,
  type ViewStyle,
} from "react-native";
import Animated, { type CSSStyle, cubicBezier, useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import type { CommandFailure } from "@/host-session/command-outcome";
import { taskStatusLabel, taskStatusTone } from "@/features/tasks/presentation/task-status-paint";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { themeStyleCache } from "@/theme/theme-style-cache";
import { Badge, BadgePlaceholder } from "@/ui/badge";
import { ActionMenu } from "@/ui/action-menu";
import { RoleIcon, RuntimeIcon } from "@/ui/brand-icons";
import { Button } from "@/ui/button";
import { Icon } from "@/ui/icon";
import { TextPlaceholder } from "@/ui/placeholders";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { radius, sansWeight } from "@/theme/tokens";
import { Touchable } from "@/ui/touchable";
import {
  type DesktopColorName,
  parseSessionMenuAction,
  sessionEntryDestination,
  sessionEntryDotColor,
  sessionEntryIconColor,
  sessionEntryTitleColor,
  sessionMenuItems,
  sessionRowAccessibleLabel,
  type SessionRowSurface,
  sessionRowSurface,
} from "./session-list-model";
import { useSessionCommandCount } from "./session-commands";
import { SwipeRow, type SwipeRowGroup } from "./swipe-row";
import type { RunSessionAction } from "./use-session-actions";

/** The plain styles of a row color. A session list renders many rows, so a row calls no style function. */
const colorStyles = themeStyleCache((theme, color: DesktopColorName) => ({
  text: { color: theme.desktop[color] },
  dot: { backgroundColor: theme.desktop[color] },
}));
/** The glow and the ring of a running dot. Only the opaque running colors get them. */
const pulseStyles = themeStyleCache((theme, color: DesktopColorName) => ({
  glow: { backgroundColor: withAlpha(theme.desktop[color], 0.28) },
  ring: { borderColor: withAlpha(theme.desktop[color], 0.48) },
}));

/** The read state and live state of a row in one fixed spot, as the desktop status dot. */
function StatusDot({
  entry,
  unread,
}: {
  entry: SessionNavigationEntry;
  unread: boolean;
}): ReactElement {
  const reducedMotion = useReducedMotion();
  const theme = useAppTheme();
  const color = sessionEntryDotColor(entry, unread);
  const running = entry.status.kind === "running" && entry.attention.length === 0;
  return (
    <View style={styles.dotFrame}>
      {running ? (
        <>
          {/* The desktop `running-status-dot`: a glow and a ring that pulse around the dot. */}
          <Animated.View
            style={[
              styles.dotGlow,
              pulseStyles(theme, color).glow,
              reducedMotion ? null : RUNNING_GLOW,
            ]}
          />
          {reducedMotion ? null : (
            <Animated.View style={[styles.dotRing, pulseStyles(theme, color).ring, RUNNING_RING]} />
          )}
        </>
      ) : null}
      <View style={[styles.dot, colorStyles(theme, color).dot]} />
    </View>
  );
}

/** The desktop `odt-task-tab-status-glow` keyframes. */
const RUNNING_GLOW: CSSStyle<ViewStyle> = {
  animationName: {
    "0%": { opacity: 0.08, transform: [{ scale: 0.94 }] },
    "45%": { opacity: 0.58, transform: [{ scale: 1.12 }] },
    "72%": { opacity: 0.18, transform: [{ scale: 1.18 }] },
    "100%": { opacity: 0.08, transform: [{ scale: 0.94 }] },
  },
  animationDuration: 1350,
  animationIterationCount: "infinite",
  animationTimingFunction: "ease-in-out",
};

/** The desktop `odt-task-tab-status-ring` keyframes. */
const RUNNING_RING: CSSStyle<ViewStyle> = {
  animationName: {
    "0%": { opacity: 0.56, transform: [{ scale: 0.92 }] },
    "72%": { opacity: 0, transform: [{ scale: 1.28 }] },
    "100%": { opacity: 0, transform: [{ scale: 1.28 }] },
  },
  animationDuration: 1350,
  animationIterationCount: "infinite",
  animationTimingFunction: cubicBezier(0.16, 1, 0.3, 1),
};

/** The right side of the first line: what the session asks, or a problem and the time. */
function RowMetadata({
  entry,
  starting,
}: {
  entry: SessionNavigationEntry;
  starting: boolean;
}): ReactElement | null {
  const elapsed = useMinuteClockLabel((now) => sessionEntryShortTime(entry, now));
  if (starting) return <StartingSpinner />;
  const reasons = visibleAttentionReasons(entry);
  if (reasons.length > 0) {
    return (
      <View style={styles.meta}>
        {reasons.map((reason) => (
          <View key={reason} style={styles.attention}>
            <Text style={styles.attentionText}>{ATTENTION_REASON_LABELS[reason]}</Text>
          </View>
        ))}
      </View>
    );
  }
  let issue: ReactElement | null = null;
  if (entry.fault) {
    issue = <Icon name="triangle-alert" size={13} colorStyle={styles.warningIssue} />;
  } else if (entry.status.kind === "settled" && entry.status.failed) {
    issue = <Icon name="circle-alert" size={13} colorStyle={styles.failedIssue} />;
  } else if (entry.status.kind === "unavailable") {
    issue = <Icon name="circle-alert" size={13} colorStyle={styles.unavailableIssue} />;
  }
  const time = entry.status.kind === "running" ? null : elapsed;
  if (!issue && !time) return null;
  return (
    <View style={styles.meta}>
      {issue}
      {time ? (
        // A start time, not a last activity, shows in italic, as on desktop.
        <Text tabular style={[styles.time, entry.time.kind === "started" ? styles.started : null]}>
          {time}
        </Text>
      ) : null}
    </View>
  );
}

/** The spinner of a chat that starts. A theme change renders only this spinner again. */
function StartingSpinner(): ReactElement {
  const theme = useAppTheme();
  return <ActivityIndicator size="small" color={theme.desktop.infoAccent} />;
}

/** The role icon of a task session. A theme change renders only this icon again. */
function EntryRoleIcon({
  role,
  color,
}: {
  role: AgentRole;
  color: DesktopColorName;
}): ReactElement {
  const theme = useAppTheme();
  return <RoleIcon role={role} size={17} color={theme.desktop[color]} />;
}

/** The role icon of a task session, a chat icon, or a task icon for a blocked task. */
function EntryIcon({ entry }: { entry: SessionNavigationEntry }): ReactElement {
  const theme = useAppTheme();
  const color = sessionEntryIconColor(entry);
  if (entry.target.kind === "task_session") {
    return <EntryRoleIcon role={entry.target.role} color={color} />;
  }
  return (
    <Icon
      name={entry.target.kind === "workspace_session" ? "messages-square" : "clipboard-list"}
      size={17}
      colorStyle={colorStyles(theme, color).text}
    />
  );
}

/**
 * One session as the desktop sidebar row: the read dot, the workspace, the task status, and what
 * the session asks or when it last worked on the first line; the role or chat icon, the title, and
 * the runtime mark on the second. The row takes the warning color when the session needs you and
 * the running color while it works. A long press opens the session menu. A swipe to the left
 * archives a chat.
 */
export const SessionRow = memo(function SessionRow({
  entry,
  starting,
  failure,
  swipeGroup,
  onOpen,
  onAction,
  onDismissFailure,
}: {
  entry: SessionNavigationEntry;
  /** True while a chat starts its runtime session before it opens. */
  starting: boolean;
  /** Why the last open of this chat failed. */
  failure: CommandFailure | null;
  swipeGroup: SwipeRowGroup;
  onOpen: (entry: SessionNavigationEntry) => void;
  onAction: RunSessionAction;
  onDismissFailure: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const unread = useSessionUnread(entry);
  const items = useMemo(() => sessionMenuItems(entry, unread), [entry, unread]);
  const accessibilityActions = useMemo(
    () =>
      items.filter((item) => !item.disabled).map((item) => ({ name: item.id, label: item.title })),
    [items],
  );
  const select = useCallback(
    (id: string) => {
      const action = parseSessionMenuAction(id);
      if (action) onAction(entry, action, unread);
    },
    [entry, onAction, unread],
  );
  const runAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => select(event.nativeEvent.actionName),
    [select],
  );
  const archive = useCallback(() => onAction(entry, "archive", unread), [entry, onAction, unread]);
  const open = useCallback(() => {
    swipeGroup.closeOpenRow();
    onOpen(entry);
  }, [entry, onOpen, swipeGroup]);
  const chat = entry.context.kind === "workspace";
  const task = entry.context.kind === "task" ? entry.context.task : null;
  const notStarted = sessionEntryDestination(entry).kind === "not_started";
  const commandCount = useSessionCommandCount(entry);
  const label = sessionRowAccessibleLabel(entry, { commandCount, unread, starting });
  const surface = styles[SURFACE_STYLES[sessionRowSurface(entry)]];

  return (
    <View style={styles.cell}>
      <SwipeRow
        resetKey={entry.key}
        label="Archive"
        icon="archive"
        onAction={archive}
        enabled={chat && !starting}
        group={swipeGroup}
      >
        {/* A tap opens the session; only a long press opens the session menu. */}
        <ActionMenu title={entry.title} items={items} onSelect={select} openOnLongPress>
          <Touchable
            feedback="scale"
            onPress={open}
            disabled={starting}
            dimWhenDisabled={false}
            radius={radius.lg}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={notStarted ? "Starts the chat, then opens it." : undefined}
            accessibilityState={{ busy: starting }}
            accessibilityActions={accessibilityActions}
            onAccessibilityAction={runAccessibilityAction}
            style={[styles.row, surface]}
          >
            <View style={styles.line}>
              <StatusDot entry={entry} unread={unread} />
              <Text numberOfLines={1} style={styles.workspace}>
                {entry.workspace.workspaceName}
              </Text>
              {task ? (
                // The desktop row names a blocked task "Blocked"; its attention says the rest.
                <Badge
                  label={task.status === "blocked" ? "Blocked" : taskStatusLabel(task.status)}
                  tone={taskStatusTone(task.status)}
                />
              ) : null}
              <RowMetadata entry={entry} starting={starting} />
            </View>
            <View style={styles.line}>
              <View style={styles.iconFrame}>
                <EntryIcon entry={entry} />
              </View>
              <Text
                numberOfLines={2}
                style={[
                  styles.title,
                  colorStyles(theme, sessionEntryTitleColor(entry, unread)).text,
                ]}
              >
                {entry.title}
              </Text>
              {commandCount > 0 ? (
                // The desktop active command mark: a terminal in the running foreground.
                <Icon name="square-terminal" size={14} colorStyle={styles.commandMark} />
              ) : null}
              {entry.runtimeKind ? <RuntimeIcon runtimeKind={entry.runtimeKind} size={15} /> : null}
            </View>
          </Touchable>
        </ActionMenu>
      </SwipeRow>
      {failure ? <RowFailure failure={failure} onDismiss={onDismissFailure} /> : null}
    </View>
  );
});

/**
 * A row for the first load: the card, the status dot, the badge of a task, and the icon of a row
 * whose title fits on one line, with bars in place of the text. It uses the row styles, and its lines are as tall as
 * the text of a row at the system text size, so the loaded list takes its exact place.
 */
export function SessionRowPlaceholder({
  task,
  workspaceWidth,
  titleWidth,
}: {
  /** True for the row of a task, which shows the task status badge. */
  task: boolean;
  workspaceWidth: DimensionValue;
  titleWidth: DimensionValue;
}): ReactElement {
  return (
    <View style={styles.cell}>
      <View style={[styles.row, styles.plainSurface]}>
        <View style={styles.line}>
          <View style={styles.dotFrame}>
            <View style={[styles.dot, styles.placeholderFill]} />
          </View>
          <TextPlaceholder variant="caption1" width={workspaceWidth} style={styles.fill} />
          {task ? <BadgePlaceholder width={64} /> : null}
          <TextPlaceholder variant="caption2" width={34} />
        </View>
        <View style={styles.line}>
          <View style={styles.iconFrame}>
            <View style={styles.placeholderIcon} />
          </View>
          <TextPlaceholder width={titleWidth} style={styles.fill} />
        </View>
      </View>
    </View>
  );
}

/** Why the last open of a chat failed, under its row. */
function RowFailure({
  failure,
  onDismiss,
}: {
  failure: CommandFailure;
  onDismiss: () => void;
}): ReactElement {
  return (
    <View style={styles.failure}>
      <Callout
        tone={failure.kind === "unknown" ? "warning" : "destructive"}
        title={failure.title}
        message={failure.message}
        action={<Button label="Dismiss" size="sm" variant="outline" onPress={onDismiss} />}
      />
    </View>
  );
}

// A list renders many rows, so each picks a plain style entry instead of a stylesheet variant,
// which runs native code on each render.
const SURFACE_STYLES = {
  attention: "attentionSurface",
  running: "runningSurface",
  plain: "plainSurface",
} as const satisfies Record<SessionRowSurface, string>;

const styles = StyleSheet.create((theme) => ({
  cell: { paddingHorizontal: theme.layout.screenPadding, paddingVertical: 3 },
  row: {
    gap: 4,
    paddingHorizontal: theme.space.md,
    paddingVertical: 10,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    boxShadow: theme.shadows.card,
  },
  attentionSurface: {
    backgroundColor: theme.desktop.warningSurface,
    borderColor: theme.desktop.warningBorder,
  },
  runningSurface: {
    backgroundColor: theme.desktop.infoSurface,
    borderColor: theme.desktop.infoBorder,
  },
  plainSurface: {
    backgroundColor: theme.desktop.sidebar,
    borderColor: theme.desktop.sidebarBorder,
  },
  line: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minWidth: 0 },
  dotFrame: { width: 18, alignItems: "center", justifyContent: "center" },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotGlow: { position: "absolute", width: 15, height: 15, borderRadius: 8 },
  dotRing: { position: "absolute", width: 13, height: 13, borderRadius: 7, borderWidth: 1 },
  warningIssue: { color: theme.desktop.warningAccent },
  failedIssue: { color: theme.desktop.destructive },
  unavailableIssue: { color: theme.desktop.sidebarMutedForeground },
  commandMark: { color: theme.desktop.statusRunningForeground },
  workspace: {
    ...theme.type.caption1,
    ...sansWeight("medium"),
    flex: 1,
    color: theme.desktop.sidebarForeground,
  },
  meta: { flexDirection: "row", alignItems: "center", gap: 4 },
  attention: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.radius.xs,
    borderWidth: 1,
    borderColor: theme.desktop.warningBorder,
    backgroundColor: theme.desktop.warningSurface,
  },
  attentionText: {
    ...theme.type.caption2,
    ...sansWeight("medium"),
    color: theme.desktop.warningMuted,
  },
  time: {
    ...theme.type.caption2,
    ...sansWeight("medium"),
    color: theme.desktop.sidebarForeground,
  },
  // Android draws a slanted font past its measured width, so the last letter needs room.
  started: { fontStyle: "italic", paddingRight: 2 },
  iconFrame: { width: 18, alignItems: "center", justifyContent: "center" },
  title: {
    ...theme.type.body,
    ...sansWeight("medium"),
    flex: 1,
  },
  failure: { paddingTop: theme.space.sm },
  fill: { flex: 1 },
  placeholderFill: { backgroundColor: theme.colors.fill },
  placeholderIcon: { width: 14, height: 14, borderRadius: 4, backgroundColor: theme.colors.fill },
}));

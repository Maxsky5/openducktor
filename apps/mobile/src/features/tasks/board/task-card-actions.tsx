import { type BuiltinRoleId as AgentRole } from "@openducktor/workflows";
import type { ReactElement } from "react";
import { ActivityIndicator, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { taskActionSendsCommand } from "@/features/workflow/task-action-routing";
import { useCommandBlocked } from "@/host-session/active-session-context";
import { useAppTheme } from "@/theme/app-theme-context";
import { themeStyleCache } from "@/theme/theme-style-cache";
import { type AppTheme, radius, touchSlop, verticalTouchSlop } from "@/theme/tokens";
import { RoleIcon } from "@/ui/brand-icons";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { taskActionRole } from "../presentation/task-action-paint";
import type { TaskCardLiveSession, TaskCardPrimary } from "./task-card-model";

/** The desktop card control height: `h-8`, between the compact `h-7` and the normal `h-9`. */
const CONTROL_HEIGHT = 32;
/** The gap between the card controls. The side slops of two neighbors fill it, with no overlap. */
export const CONTROL_GAP = 6;
const PRIMARY_SIDE_SLOP = 2;
/** Grows a card control to the platform touch target. */
const PRIMARY_SLOP = {
  ...verticalTouchSlop(CONTROL_HEIGHT),
  left: PRIMARY_SIDE_SLOP,
  right: PRIMARY_SIDE_SLOP,
};

type Appearance = TaskCardPrimary["appearance"];

/** The text and icon color of each card action style. */
// The cards of a board render many actions, so each picks a plain style entry instead of a
// stylesheet variant, which runs native code on each render.
const CONTROL_STYLES = {
  filled: "filledControl",
  outline: "outlineControl",
  destructive: "destructiveControl",
  running: "runningControl",
  waiting: "waitingControl",
} as const satisfies Record<Appearance, string>;

const foregroundColor = (theme: AppTheme, appearance: Appearance): string =>
  ({
    filled: theme.desktop.primaryForeground,
    outline: theme.desktop.foreground,
    destructive: theme.desktop.destructiveForeground,
    running: theme.desktop.infoMuted,
    waiting: theme.desktop.warningMuted,
  })[appearance];

/** The sky chip of a running session, or the amber chip of a session that waits for input. */
const liveColors = (theme: AppTheme, waiting: boolean) => {
  const d = theme.desktop;
  return waiting
    ? { surface: d.warningSurface, border: d.warningBorder, text: d.warningMuted }
    : { surface: d.infoSurface, border: d.infoBorder, text: d.infoMuted };
};

/** The plain text styles of an action and of a live chip. Boards render many cards. */
const foregroundStyles = themeStyleCache((theme, appearance: Appearance) => ({
  color: foregroundColor(theme, appearance),
}));
const liveStyles = themeStyleCache((theme, waiting: boolean) => {
  const colors = liveColors(theme, waiting);
  return {
    chip: { backgroundColor: colors.surface, borderColor: colors.border },
    text: { color: colors.text },
  };
});

/**
 * The next workflow action of a card as a compact desktop button: violet for the next step,
 * outlined for other starts, rose for a reset. The control of a live session is the desktop
 * session chip: sky while it runs, amber while it waits for input.
 */
export function CardPrimaryAction({
  primary,
  taskTitle,
  onPress,
}: {
  primary: TaskCardPrimary;
  taskTitle: string;
  onPress: () => void;
}): ReactElement {
  const { appearance } = primary;
  const control = [styles.control, styles[CONTROL_STYLES[appearance]]];
  const foreground = foregroundStyles(useAppTheme(), appearance);
  // A start, an approval, or a change needs the live host. Opening a session does not.
  const blockedByConnection = useCommandBlocked(
    taskActionSendsCommand(primary.action),
    primary.label,
  );
  const disabled = primary.disabled || blockedByConnection;
  const session = primary.activeSession;
  if ((appearance === "running" || appearance === "waiting") && session) {
    return (
      <Touchable
        feedback="scale"
        onPress={onPress}
        disabled={disabled}
        radius={radius.sm}
        hitSlop={PRIMARY_SLOP}
        accessibilityRole="button"
        accessibilityLabel={`${primary.label}, ${session.roleLabel} ${session.statusLabel}`}
        accessibilityState={{ disabled }}
        containerStyle={styles.shrink}
        style={control}
      >
        {/* The desktop chip: a play mark in the chip text color in both states. */}
        <Icon name="play-circle" size={14} colorStyle={foreground} />
        <Text
          variant="subhead"
          weight="semibold"
          numberOfLines={1}
          style={[styles.label, foreground]}
        >
          {session.roleLabel}
        </Text>
        <Text
          variant="caption2"
          weight="medium"
          numberOfLines={1}
          style={[
            styles.status,
            appearance === "running" ? styles.runningStatus : styles.waitingStatus,
          ]}
        >
          {session.statusLabel}
        </Text>
      </Touchable>
    );
  }
  const role = taskActionRole(primary.action);
  return (
    <Touchable
      feedback="scale"
      onPress={onPress}
      disabled={disabled}
      radius={radius.sm}
      hitSlop={PRIMARY_SLOP}
      accessibilityRole="button"
      accessibilityLabel={`${primary.label} for ${taskTitle}`}
      accessibilityHint={primaryHint(primary.disabled, blockedByConnection)}
      accessibilityState={{ disabled }}
      containerStyle={styles.shrink}
      style={control}
    >
      {role ? (
        <ActionRoleIcon role={role} appearance={appearance} />
      ) : (
        <Icon name={primary.icon} size={14} colorStyle={foreground} />
      )}
      <Text
        variant="subhead"
        weight="semibold"
        numberOfLines={1}
        style={[styles.label, foreground]}
      >
        {primary.label}
      </Text>
    </Touchable>
  );
}

/** Why the next action of a card is off, for screen readers. */
const primaryHint = (sessionMissing: boolean, blockedByConnection: boolean): string | undefined => {
  if (blockedByConnection) return "Available when the host connection is live.";
  if (sessionMissing) return "The session of this action is not found yet.";
  return undefined;
};

/** The desktop chevron that opens the other actions of a card. */
export function CardMenuButton({
  accessibilityLabel,
}: {
  accessibilityLabel: string;
}): ReactElement {
  // The chevron is at the card edge, so the slop after it adds the width that the gap cannot.
  const slop = touchSlop(CONTROL_HEIGHT);
  const left = CONTROL_GAP - PRIMARY_SIDE_SLOP;
  return (
    <Touchable
      feedback="scale"
      radius={radius.sm}
      hitSlop={{ top: slop, bottom: slop, left, right: slop * 2 - left }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.menuButton}
    >
      <Icon name="chevron-down" size={15} colorStyle={styles.menuIcon} />
    </Touchable>
  );
}

/**
 * The live session of a card without a session control, such as a task without a next action:
 * a sky chip while it runs, an amber chip while it waits for input.
 */
export function LiveSessionChip({ session }: { session: TaskCardLiveSession }): ReactElement {
  const waiting = session.waitingInput;
  const live = liveStyles(useAppTheme(), waiting);
  return (
    <View
      accessible
      accessibilityLabel={session.label}
      pointerEvents="none"
      style={[styles.live, live.chip]}
    >
      <LiveRoleIcon role={session.role} waiting={waiting} />
      <Text variant="caption2" numberOfLines={1} style={[styles.shrink, live.text]}>
        {session.label}
      </Text>
      {waiting ? (
        <Icon name="circle-alert" size={12} colorStyle={styles.liveAlert} />
      ) : (
        <LiveSpinner />
      )}
    </View>
  );
}

/** The role icon of a card action. A theme change renders only this icon again. */
function ActionRoleIcon({
  role,
  appearance,
}: {
  role: AgentRole;
  appearance: Appearance;
}): ReactElement {
  const theme = useAppTheme();
  return <RoleIcon role={role} size={14} color={foregroundColor(theme, appearance)} />;
}

/** The role icon of a live session chip. A theme change renders only this icon again. */
function LiveRoleIcon({ role, waiting }: { role: AgentRole; waiting: boolean }): ReactElement {
  const theme = useAppTheme();
  return <RoleIcon role={role} size={12} color={liveColors(theme, waiting).text} />;
}

/** The spinner of a running session. A theme change renders only this spinner again. */
function LiveSpinner(): ReactElement {
  const theme = useAppTheme();
  return (
    <ActivityIndicator size="small" color={theme.desktop.infoAccent} style={styles.liveSpinner} />
  );
}

/** The workflow action and the menu button of a card for a first load, in their sizes. */
export function CardActionsPlaceholder(): ReactElement {
  return (
    <>
      <View style={[styles.control, styles.outlineControl, styles.placeholderAction]} />
      <View style={[styles.menuButton, styles.placeholderMenu]} />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  shrink: { flexShrink: 1 },
  control: {
    minHeight: CONTROL_HEIGHT,
    maxWidth: 210,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  filledControl: {
    backgroundColor: theme.desktop.primary,
    borderColor: theme.desktop.primary,
    boxShadow: theme.shadows.card,
  },
  outlineControl: {
    backgroundColor: theme.desktop.card,
    borderColor: theme.desktop.input,
    boxShadow: theme.shadows.card,
  },
  destructiveControl: {
    backgroundColor: theme.desktop.destructive,
    borderColor: theme.desktop.destructive,
  },
  runningControl: {
    backgroundColor: theme.desktop.infoSurface,
    borderColor: theme.desktop.infoBorder,
  },
  waitingControl: {
    backgroundColor: theme.desktop.warningSurface,
    borderColor: theme.desktop.warningBorder,
  },
  label: { flexShrink: 1 },
  status: { flexShrink: 0 },
  runningStatus: { color: theme.desktop.statusRunning },
  waitingStatus: { color: theme.desktop.warningSurfaceForeground },
  menuIcon: { color: theme.desktop.foreground },
  // About the width of "Start Builder", the most common action of a card.
  placeholderAction: {
    width: 118,
    borderRadius: theme.radius.sm,
    borderColor: theme.colors.fill,
    backgroundColor: theme.colors.fill,
    boxShadow: "none",
  },
  placeholderMenu: {
    borderRadius: theme.radius.sm,
    borderColor: theme.colors.fill,
    backgroundColor: theme.colors.fill,
    boxShadow: "none",
  },
  menuButton: {
    width: CONTROL_HEIGHT,
    height: CONTROL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
  },
  live: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 5,
    minHeight: 22,
    paddingHorizontal: 8,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  liveSpinner: { width: 12, height: 12, transform: [{ scale: 0.6 }] },
  liveAlert: { color: theme.desktop.warningAccent },
}));

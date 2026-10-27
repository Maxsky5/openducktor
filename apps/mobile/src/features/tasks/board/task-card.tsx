import type { AgentSessionRecord } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import type {
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@openducktor/frontend-core/tasks/board/kanban-task-activity";
import {
  type TaskWorkflowAction,
  type BuiltinTaskCard as TaskCardData,
  type BuiltinRoleId as AgentRole,
} from "@openducktor/workflows";
import type { SessionTargetOptions } from "@openducktor/frontend-core/tasks/board/session-target-resolution";
import { memo, type ReactElement, use, useCallback, useMemo, useRef } from "react";
import { type DimensionValue, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { taskActionSendsCommand } from "@/features/workflow/task-action-routing";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { ActionMenu, type ActionMenuHandle, type ActionMenuItem } from "@/ui/action-menu";
import { BadgePlaceholder } from "@/ui/badge";
import { BorderRay } from "@/ui/border-ray";
import { TextPlaceholder } from "@/ui/placeholders";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { issueTypePaint } from "../presentation/task-badge-paint";
import {
  PriorityBadge,
  TaskLabelChip,
  TaskLabelCountChip,
  TaskStatusChips,
} from "../presentation/task-badges";
import { IssueTypeMark } from "../presentation/task-chip";
import { useCopyTaskId } from "../presentation/use-copy-task-id";
import { taskActionRole } from "../presentation/task-action-paint";
import {
  CardActionsPlaceholder,
  CardMenuButton,
  CardPrimaryAction,
  CONTROL_GAP,
  LiveSessionChip,
} from "./task-card-actions";
import { LaneShownContext } from "./lane-shown-context";
import { buildTaskCardModel, type TaskCardModel } from "./task-card-model";

export type TaskCardHandlers = {
  onOpenDetails: (task: TaskCardData) => void;
  onAction: (
    task: TaskCardData,
    action: TaskWorkflowAction,
    sessionOptionsByRole: TaskCardModel["sessionOptionsByRole"],
  ) => void;
  onOpenSession: (task: TaskCardData, role: AgentRole, options: SessionTargetOptions) => void;
};

export type TaskCardProps = TaskCardHandlers & {
  task: TaskCardData;
  taskSessions: KanbanTaskSession[];
  historicalSessions: AgentSessionRecord[];
  activeSessionRole: AgentRole | undefined;
  taskActivityState: KanbanTaskActivityState;
  /** The target that the task branch is merged into. The card then proposes Close Task. */
  mergedTarget: string | undefined;
  /** True when the card shows in the detail area next to the board. */
  selected: boolean;
};

const SHORTCUT_PREFIX = "session:";
const COPY_ID = "copy_id";

/**
 * Every action of a card for its menu, as the desktop card menu: the other workflow actions,
 * the sessions to open, and Copy Task ID, which the desktop card shows next to the ID.
 */
const menuItems = (model: TaskCardModel): ActionMenuItem[] => [
  ...model.menu.map((item) => ({
    id: item.id,
    title: item.title,
    icon: item.icon,
    role: taskActionRole(item.id) ?? undefined,
    destructive: item.destructive,
    disabled: item.disabled,
    command: taskActionSendsCommand(item.id),
  })),
  ...model.shortcuts.map((shortcut): ActionMenuItem => ({
    id: `${SHORTCUT_PREFIX}${shortcut.role}`,
    title: `Open ${shortcut.label}`,
    icon: "square-arrow-out-up-right",
  })),
  { id: COPY_ID, title: "Copy Task ID", icon: "copy" },
];

/**
 * The frame style of a card: the detail selection, a live session, or the plain outline. A board
 * renders many cards, so each picks a plain style entry instead of a stylesheet variant, which
 * runs native code on each render.
 */
const cardFrame = (
  selected: boolean,
  model: TaskCardModel,
): "selectedFrame" | "runningFrame" | "waitingFrame" | "idleFrame" => {
  if (selected) return "selectedFrame";
  if (!model.liveSession) return "idleFrame";
  return model.liveSession.waitingInput ? "waitingFrame" : "runningFrame";
};

/**
 * A dense board card after the desktop card: the title on up to two lines, the status badges,
 * then a footer with the issue type, the priority, the ID, and the next workflow action as a
 * compact control. The chevron and a long press open the other actions. A live session colors
 * the frame sky, or amber while it waits for input, and takes the place of the next action.
 */
export const TaskCard = memo(function TaskCard({
  task,
  taskSessions,
  historicalSessions,
  activeSessionRole,
  taskActivityState,
  mergedTarget,
  selected,
  onOpenDetails,
  onAction,
  onOpenSession,
}: TaskCardProps): ReactElement {
  const model = useMemo(
    () =>
      buildTaskCardModel({
        task,
        taskSessions,
        historicalSessions,
        activeSessionRole,
        taskActivityState,
        mergedTarget,
      }),
    [activeSessionRole, historicalSessions, mergedTarget, task, taskActivityState, taskSessions],
  );
  const items = useMemo(() => menuItems(model), [model]);
  const menuRef = useRef<ActionMenuHandle>(null);
  const copyTaskId = useCopyTaskId();
  // As on desktop, a light runs around the card while its session works.
  const running = model.liveSession !== null && !model.liveSession.waitingInput;
  const frame = styles[cardFrame(selected, model)];

  const selectMenu = useCallback(
    (id: string) => {
      if (id === COPY_ID) {
        copyTaskId(task.id);
        return;
      }
      if (id.startsWith(SHORTCUT_PREFIX)) {
        const shortcut = model.shortcuts.find((entry) => `${SHORTCUT_PREFIX}${entry.role}` === id);
        if (shortcut) onOpenSession(task, shortcut.role, shortcut.options);
        return;
      }
      const item = model.menu.find((entry) => entry.id === id);
      if (item) onAction(task, item.id, model.sessionOptionsByRole);
    },
    [copyTaskId, model, onAction, onOpenSession, task],
  );

  const { primary, liveSession } = model;
  const primaryShowsSession = primary !== null && primary.activeSession !== null;
  const hasWorkflowMenu = model.menu.length > 0 || model.shortcuts.length > 0;
  const paint = issueTypePaint(task.issueType);
  return (
    <View style={[styles.card, frame]}>
      {/* The press layer fills the card under its content, so the action controls stay apart. */}
      <Touchable
        feedback="highlight"
        onPress={() => onOpenDetails(task)}
        onLongPress={() => menuRef.current?.show()}
        radius={CARD_RADIUS - 1}
        accessibilityRole="button"
        accessibilityLabel={model.accessibilityLabel}
        accessibilityHint="Opens the task details. Long press for more actions."
        accessibilityState={{ selected }}
        style={styles.pressLayer}
      >
        {null}
      </Touchable>
      <View pointerEvents="box-none" style={styles.content}>
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text variant="headline" numberOfLines={2} style={styles.title}>
            {model.title}
          </Text>
        </View>
        <TaskStatusChips
          task={task}
          qaRejected={model.qaRejected}
          mergedTarget={mergedTarget}
          size="sm"
        />
        {model.visibleLabels.length > 0 ? (
          // The desktop label row: the first labels, then a "+N" count of the others. The card
          // label names every label for screen readers.
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.labels}
          >
            {model.visibleLabels.map((label) => (
              <TaskLabelChip key={label} label={label} size="sm" />
            ))}
            {model.hiddenLabels.length > 0 ? (
              <TaskLabelCountChip count={model.hiddenLabels.length} size="sm" />
            ) : null}
          </View>
        ) : null}
        {liveSession && !primaryShowsSession ? <LiveSessionChip session={liveSession} /> : null}
        <View pointerEvents="box-none" style={styles.footer}>
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.meta}
          >
            <IssueTypeMark issueType={task.issueType} icon={paint.icon} />
            {/* The ID gives way first, so the priority always reads. */}
            <View style={styles.fixed}>
              <PriorityBadge priority={task.priority} size="sm" />
            </View>
            <Text variant="monoSmall" numberOfLines={1} style={styles.id}>
              {model.taskId}
            </Text>
          </View>
          {primary ? (
            <CardPrimaryAction
              primary={primary}
              taskTitle={task.title}
              onPress={() => onAction(task, primary.action, model.sessionOptionsByRole)}
            />
          ) : null}
          {/* Without workflow actions the menu has only Copy Task ID, so a long press opens it from
              an anchor outside the row flow and the card shows no control. */}
          <View pointerEvents="box-none" style={hasWorkflowMenu ? null : styles.anchorSlot}>
            <ActionMenu title={task.title} items={items} onSelect={selectMenu} menuRef={menuRef}>
              {hasWorkflowMenu ? (
                <CardMenuButton accessibilityLabel={`More actions for ${task.title}`} />
              ) : (
                <View style={styles.anchor} />
              )}
            </ActionMenu>
          </View>
        </View>
      </View>
      {running ? <RunningRay /> : null}
    </View>
  );
}, sameCardProps);

/**
 * The light around a working card, while its screen has focus. A theme change or a focus change
 * renders only this light again, so the board does not render its lanes on a tab change.
 */
function RunningRay(): ReactElement | null {
  const theme = useAppTheme();
  const laneShown = use(LaneShownContext);
  if (!laneShown) return null;
  return (
    <BorderRay
      color={theme.desktop.statusRunning}
      radius={CARD_RADIUS}
      turnMs={2000}
      strokeWidth={4}
    />
  );
}

const sameSessions = (left: KanbanTaskSession[], right: KanbanTaskSession[]): boolean =>
  left === right ||
  (left.length === right.length &&
    left.every((session, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        agentSessionIdentityKey(session) === agentSessionIdentityKey(other) &&
        session.role === other.role &&
        session.activityState === other.activityState &&
        session.startedAt === other.startedAt
      );
    }));

function sameCardProps(previous: TaskCardProps, next: TaskCardProps): boolean {
  return (
    previous.task === next.task &&
    previous.historicalSessions === next.historicalSessions &&
    previous.activeSessionRole === next.activeSessionRole &&
    previous.taskActivityState === next.taskActivityState &&
    previous.selected === next.selected &&
    previous.onOpenDetails === next.onOpenDetails &&
    previous.onAction === next.onAction &&
    previous.onOpenSession === next.onOpenSession &&
    sameSessions(previous.taskSessions, next.taskSessions)
  );
}

/** The desktop card radius, `rounded-xl`. */
const CARD_RADIUS = 12;

/**
 * A card for a first load: a one-line title, the type mark, the priority badge, the ID, and the
 * card controls, with bars in place of the text. It uses the card styles, so the loaded lane takes
 * its exact place.
 */
export function TaskCardPlaceholder({ titleWidth }: { titleWidth: DimensionValue }): ReactElement {
  return (
    <View style={[styles.card, styles.idleFrame]}>
      <View style={styles.content}>
        <TextPlaceholder variant="headline" width={titleWidth} />
        <View style={styles.footer}>
          <View style={styles.meta}>
            <View style={styles.placeholderMark} />
            <BadgePlaceholder width={44} />
            <TextPlaceholder variant="monoSmall" width={72} />
          </View>
          <CardActionsPlaceholder />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    borderRadius: CARD_RADIUS,
    borderCurve: "continuous",
    borderWidth: 1,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
  },
  idleFrame: { borderColor: theme.desktop.border },
  // `.kanban-active-session-card`: a sky border and glow under the running ray.
  runningFrame: {
    borderColor: withAlpha(theme.palette.sky500, 0.58),
    boxShadow: `0 0 9px ${withAlpha(theme.palette.sky500, 0.22)}`,
  },
  // `.kanban-waiting-input-card`: the warning ring and its glow.
  waitingFrame: {
    borderColor: theme.desktop.warningBorder,
    boxShadow: `0 0 0 1px ${withAlpha(theme.desktop.warningBorder, 0.72)}, 0 0 18px ${withAlpha(theme.desktop.warningRing, 0.3)}`,
  },
  selectedFrame: {
    borderColor: theme.colors.tint,
    outlineWidth: 1,
    outlineColor: theme.colors.tint,
  },
  pressLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  content: {
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingTop: 10,
    paddingBottom: theme.space.sm,
  },
  title: { color: theme.desktop.foreground },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: CONTROL_GAP,
    minHeight: 32,
  },
  meta: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fixed: { flexShrink: 0 },
  labels: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  id: { flexShrink: 1, color: theme.desktop.mutedForeground },
  anchorSlot: { position: "absolute", top: 0, right: 0 },
  anchor: { width: 1, height: 32 },
  // The issue type icon (`IssueTypeMark`).
  placeholderMark: { width: 15, height: 15, borderRadius: 4, backgroundColor: theme.colors.fill },
}));

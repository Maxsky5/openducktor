import {
  type BuiltinTaskCard as TaskCard,
  type BuiltinRoleId as AgentRole,
} from "@openducktor/workflows";
import { isAgentSessionActivityWorking } from "@openducktor/frontend-core/lib/agent-session-activity-state";
import type { WorkflowStepTone } from "@openducktor/frontend-core/types/agent-workflow";
import { useRouter } from "expo-router";
import { Fragment, memo, type ReactElement, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTaskSessionGroups } from "@/features/tasks/details/use-task-session-groups";
import {
  workflowConnectorColor,
  workflowToneColors,
} from "@/features/tasks/presentation/workflow-tone-paint";
import {
  type TaskWorkflowStep,
  taskWorkflowSteps,
} from "@/features/tasks/details/task-workflow-model";
import {
  routes,
  SINGLE_SHEET,
  type StartSessionSheetAction,
  switchedSessionParams,
} from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { type AppTheme, sansWeight } from "@/theme/tokens";
import { RoleIcon } from "@/ui/brand-icons";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { useRepoTask } from "@/features/work-owner/use-repo-task";

/** One row under the navigation bar, or one column in the side panel of a low or wide window. */
export type WorkflowRailOrientation = "row" | "column";

/**
 * The desktop workflow rail of a task session, in the compact `WorkflowRailPreview` form: Spec,
 * Planner, Builder, and QA, each in the color of its state. In a row, each step is a tile of
 * equal width with the role icon and state mark above the role name, so each role is an easy tap
 * target. In a column, each step is a row with the role name and its state. The step of this
 * session has a ring. A step with a session opens its newest session in place, and a step
 * without one opens the start sheet when the host allows that start.
 */
export function SessionWorkflowRail({
  workspaceId,
  repoPath,
  taskId,
  role,
  orientation,
}: {
  workspaceId: string;
  repoPath: string;
  taskId: string;
  role: AgentRole;
  orientation: WorkflowRailOrientation;
}): ReactElement | null {
  const { task } = useRepoTask(repoPath, taskId);
  if (!task) return null;
  return (
    <WorkflowRailSteps
      workspaceId={workspaceId}
      repoPath={repoPath}
      task={task}
      role={role}
      column={orientation === "column"}
    />
  );
}

/** The task action that starts the first session of each role. */
const ROLE_START_ACTIONS = {
  spec: "set_spec",
  planner: "set_plan",
  build: "build_start",
  qa: "qa_start",
} as const satisfies Record<AgentRole, StartSessionSheetAction>;

/** What a press on a step does, and how a screen reader names it. */
type StepPress = { hint: string; run: () => void };

function WorkflowRailSteps({
  workspaceId,
  repoPath,
  task,
  role,
  column,
}: {
  workspaceId: string;
  repoPath: string;
  task: TaskCard;
  role: AgentRole;
  column: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const router = useRouter();
  const { groups } = useTaskSessionGroups(repoPath, task.id);
  const steps = useMemo(() => taskWorkflowSteps(task, groups), [groups, task]);
  const availableActions = new Set(task.availableActions);
  return (
    <View
      style={column ? styles.columnBand : styles.band}
      accessibilityRole="tablist"
      accessibilityLabel="Task workflow"
    >
      {steps.map((step, index) => {
        const next = steps[index + 1];
        const { session } = step;
        const selected = step.role === role;
        // As on desktop, a step opens its newest session. A step without a session starts one when
        // the host allows that action now.
        const startAction = ROLE_START_ACTIONS[step.role];
        let press: StepPress | null = null;
        if (session && !selected) {
          press = {
            hint: `Opens the newest ${step.label} session.`,
            run: () => router.setParams(switchedSessionParams(workspaceId, session)),
          };
        } else if (!session && availableActions.has(startAction)) {
          press = {
            hint: `Starts a ${step.label} session.`,
            run: () =>
              router.push(routes.startSession(workspaceId, task.id, startAction), SINGLE_SHEET),
          };
        }
        return (
          <Fragment key={step.role}>
            <WorkflowStep step={step} selected={selected} press={press} column={column} />
            {next ? (
              <View
                style={[
                  column ? styles.columnConnector : styles.connector,
                  { backgroundColor: workflowConnectorColor(theme, next.state.tone) },
                ]}
              />
            ) : null}
          </Fragment>
        );
      })}
    </View>
  );
}

/** The desktop `WORKFLOW_SELECTION_CLASSES` ring colors. A selected blocked step rings in warning. */
const ringColor = (theme: AppTheme, tone: WorkflowStepTone): string => {
  if (tone === "available" || tone === "optional")
    return withAlpha(theme.desktop.mutedForeground, 0.5);
  if (tone === "blocked") return theme.desktop.warningRing;
  return workflowConnectorColor(theme, tone);
};

/** The state mark after the label, as the desktop `WorkflowStepContent`. */
const stateMark = (step: TaskWorkflowStep): IconName | "spinner" | null => {
  const { tone, liveSession } = step.state;
  if (tone === "done") return "check";
  if (liveSession === "waiting_input") return "circle-dashed";
  if (tone === "in_progress") {
    return liveSession !== "none" && isAgentSessionActivityWorking(liveSession)
      ? "spinner"
      : "circle-dot-dashed";
  }
  if (tone === "available") return "circle";
  if (tone === "optional") return "circle-dashed";
  if (tone === "rejected" || tone === "failed") return "triangle-alert";
  // A Builder step that waits for the user marks a blocked task.
  if (tone === "waiting_input" && step.role === "build") return "triangle-alert";
  return null;
};

const WorkflowStep = memo(function WorkflowStep({
  step,
  selected,
  press,
  column,
}: {
  step: TaskWorkflowStep;
  selected: boolean;
  press: StepPress | null;
  column: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const { tone } = step.state;
  const colors = workflowToneColors(theme, tone);
  const mark = stateMark(step);
  styles.useVariants({ tone });
  const markView =
    mark === "spinner" ? (
      <LoaderSpinner size={11} color={colors.text} />
    ) : mark ? (
      <Icon
        name={mark}
        size={11}
        colorValue={mark === "check" ? theme.desktop.successAccent : colors.text}
      />
    ) : null;
  const content = column ? (
    <View style={[styles.step, styles.columnStep, tone === "optional" && styles.dashed]}>
      <RoleIcon role={step.role} size={16} color={colors.icon} />
      <View style={styles.columnText}>
        <Text numberOfLines={1} style={[styles.label, { color: colors.text }]}>
          {step.label}
        </Text>
        <Text numberOfLines={1} style={[styles.state, { color: colors.text }]}>
          {step.stateLabel}
        </Text>
      </View>
      {markView}
    </View>
  ) : (
    <View style={[styles.step, tone === "optional" && styles.dashed]}>
      <View style={styles.marks}>
        <RoleIcon role={step.role} size={14} color={colors.icon} />
        {markView}
      </View>
      <Text numberOfLines={1} style={[styles.label, { color: colors.text }]}>
        {step.label}
      </Text>
    </View>
  );
  const frame = (
    <View style={[styles.ring, selected ? { borderColor: ringColor(theme, tone) } : null]}>
      {content}
    </View>
  );
  const label = `${step.label}, ${step.stateLabel}`;
  if (!press) {
    return (
      <View
        style={column ? styles.columnHolder : styles.holder}
        accessible
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
      >
        {frame}
      </View>
    );
  }
  return (
    <Touchable
      feedback="scale"
      radius={theme.radius.md}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={press.run}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityHint={press.hint}
      accessibilityState={{ selected }}
      containerStyle={column ? styles.columnHolder : styles.holder}
    >
      {frame}
    </Touchable>
  );
});

const styles = StyleSheet.create((theme) => ({
  // `border-b border-border bg-card px-4 py-2`, as the desktop rail band.
  band: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  // The steps of a column fill the side panel, one under the other.
  columnBand: { alignItems: "stretch", gap: 3, padding: theme.space.md },
  // The steps share the width equally, so each role is a tap target of the same size.
  holder: { flex: 1, minWidth: 0 },
  columnHolder: { alignSelf: "stretch" },
  // The desktop connectors between the steps, in the ring color of the next step.
  connector: { width: 8, height: 2, borderRadius: 1 },
  // The connector of a column runs down the middle of the panel, between two steps.
  columnConnector: { alignSelf: "center", width: 2, height: 8, borderRadius: 1 },
  // The selection ring: `ring-2 ring-offset-1`. Other steps keep the same size.
  ring: {
    padding: 1,
    borderRadius: theme.radius.md + 3,
    borderCurve: "continuous",
    borderWidth: 2,
    borderColor: "transparent",
  },
  step: {
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 4,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    variants: {
      tone: {
        in_progress: {
          borderColor: theme.desktop.infoBorder,
          backgroundColor: theme.desktop.infoSurface,
        },
        done: {
          borderColor: theme.desktop.successBorder,
          backgroundColor: theme.desktop.successSurface,
        },
        available: { borderColor: theme.desktop.input, backgroundColor: theme.desktop.card },
        optional: { borderColor: theme.desktop.input, backgroundColor: theme.desktop.card },
        rejected: {
          borderColor: theme.desktop.rejectedBorder,
          backgroundColor: theme.desktop.rejectedSurface,
        },
        waiting_input: {
          borderColor: theme.desktop.warningBorder,
          backgroundColor: theme.desktop.warningSurface,
        },
        failed: {
          borderColor: theme.desktop.destructiveBorder,
          backgroundColor: theme.desktop.destructiveSurface,
        },
        blocked: { borderColor: theme.desktop.border, backgroundColor: theme.desktop.muted },
      },
    },
  },
  // A step of a column: the role icon, the role name over its state, and the state mark.
  columnStep: {
    height: 46,
    flexDirection: "row",
    justifyContent: "flex-start",
    gap: theme.space.sm,
    paddingHorizontal: 10,
  },
  columnText: { flex: 1, minWidth: 0 },
  dashed: { borderStyle: "dashed" },
  marks: { flexDirection: "row", alignItems: "center", gap: 4 },
  label: { ...sansWeight("medium"), maxWidth: "100%", fontSize: 11.5, lineHeight: 15 },
  state: { fontSize: 11, lineHeight: 14, opacity: 0.8 },
}));

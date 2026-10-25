import { useRouter } from "expo-router";
import { Fragment, memo, type ReactElement } from "react";
import { ActivityIndicator, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { routes, sessionParams } from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { RoleIcon } from "@/ui/brand-icons";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { workflowConnectorColor, workflowToneColors } from "../presentation/workflow-tone-paint";
import type { TaskWorkflowStep } from "./task-workflow-model";

/**
 * The desktop workflow rail on a phone: Spec, Planner, Builder, and QA as the desktop role
 * buttons, in the colors of their states, joined by chevrons in the color of the next step. An
 * optional step has a dashed outline, a spinner replaces the role icon while a session works, and
 * the screen reader name of each button says its state. A step with a session opens its newest
 * session.
 */
export const TaskWorkflowRail = memo(function TaskWorkflowRail({
  workspaceId,
  taskTitle,
  steps,
}: {
  workspaceId: string;
  /** The navigation bar of the session shows the task title from the first frame. */
  taskTitle: string;
  steps: readonly TaskWorkflowStep[];
}): ReactElement {
  const router = useRouter();
  const theme = useAppTheme();
  return (
    <View style={styles.rail} accessibilityLabel="Task workflow">
      {steps.map((step, index) => {
        const { session } = step;
        const colors = workflowToneColors(theme, step.state.tone);
        const label = `${step.label}, ${step.stateLabel}`;
        const pillStyle = [
          styles.pill,
          { backgroundColor: colors.surface, borderColor: colors.border },
          step.state.tone === "optional" && styles.dashed,
        ];
        const pill = (
          <>
            {step.working ? (
              <ActivityIndicator size="small" color={colors.icon} style={styles.spinner} />
            ) : (
              <RoleIcon role={step.role} size={13} color={colors.icon} />
            )}
            <Text
              variant="caption1"
              weight="semibold"
              numberOfLines={1}
              style={[styles.pillLabel, { color: colors.text }]}
            >
              {step.label}
            </Text>
          </>
        );
        return (
          <Fragment key={step.role}>
            {index > 0 ? (
              <View style={styles.connector}>
                <Icon
                  name="chevron-right"
                  size={12}
                  colorValue={workflowConnectorColor(theme, step.state.tone)}
                />
              </View>
            ) : null}
            <View style={styles.step}>
              {session ? (
                <Touchable
                  feedback="scale"
                  onPress={() =>
                    router.push(
                      routes.session({
                        ...sessionParams(workspaceId, session),
                        title: taskTitle,
                        task: "1",
                      }),
                    )
                  }
                  radius={theme.radius.sm}
                  hitSlop={{ top: 6, bottom: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityHint={`Opens the newest ${step.label} session.`}
                  style={pillStyle}
                >
                  {pill}
                </Touchable>
              ) : (
                <View accessible accessibilityLabel={label} style={pillStyle}>
                  {pill}
                </View>
              )}
            </View>
          </Fragment>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  rail: { flexDirection: "row", alignItems: "center" },
  step: { flex: 1, minWidth: 0 },
  pill: {
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 6,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    borderWidth: 1,
  },
  dashed: { borderStyle: "dashed" },
  pillLabel: { flexShrink: 1 },
  spinner: { width: 12, height: 12, transform: [{ scale: 0.6 }] },
  connector: { width: 14, height: 30, alignItems: "center", justifyContent: "center" },
}));

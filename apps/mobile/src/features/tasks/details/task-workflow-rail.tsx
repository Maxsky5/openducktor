import { useRouter } from "expo-router";
import { Fragment, memo, type ReactElement } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
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
    <ScrollView
      horizontal
      style={styles.viewport}
      contentContainerStyle={styles.rail}
      accessibilityLabel="Task workflow"
    >
      {/* The few workflow stages form one connected rail with natural-width pills. */}
      {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
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
              <RoleIcon hint={step.iconHint} size={13} color={colors.icon} />
            )}
            <Text
              variant="caption1"
              weight="semibold"
              style={[styles.pillLabel, { color: colors.text }]}
            >
              {step.label}
            </Text>
          </>
        );
        return (
          <Fragment key={step.id}>
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
    </ScrollView>
  );
});

const styles = StyleSheet.create((theme) => ({
  viewport: { flexGrow: 0 },
  rail: { flexGrow: 1, flexDirection: "row", alignItems: "center" },
  step: { flexGrow: 1, flexShrink: 0 },
  pill: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    borderWidth: 1,
  },
  dashed: { borderStyle: "dashed" },
  pillLabel: { flexShrink: 0 },
  spinner: { width: 12, height: 12, transform: [{ scale: 0.6 }] },
  connector: { width: 14, height: 30, alignItems: "center", justifyContent: "center" },
}));

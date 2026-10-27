import type { StartupStep } from "@openducktor/contracts";
import { terminalCommandSucceeded } from "@openducktor/frontend-core/terminals/terminal-command-result";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { terminalCommandResultLabel } from "../terminals/terminal-command-result-label";
import { StartupTerminalOutput } from "./startup-terminal-output";

const STEP_LABELS = {
  pending: "Pending",
  waiting: "Waiting",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  not_run: "Did not run",
} satisfies Record<StartupStep["state"], string>;
const STEP_ICONS = {
  pending: "circle",
  waiting: "clock",
  running: "loader-circle",
  completed: "check",
  failed: "circle-alert",
  not_run: "x",
} satisfies Record<StartupStep["state"], IconName>;
export function StartupStepRow({
  attemptId,
  step,
  last,
  expanded,
  toggle,
}: {
  attemptId: string;
  step: StartupStep;
  last: boolean;
  expanded: boolean;
  toggle: () => void;
}): ReactElement {
  const hasDetails =
    step.details.length > 0 || step.action || step.failure || step.resources?.length;
  const result = step.action?.result;
  const displayState = result && !terminalCommandSucceeded(result) ? "failed" : step.state;
  return (
    <View style={styles.step}>
      {last ? null : <View pointerEvents="none" style={styles.line} />}
      <Touchable
        feedback="opacity"
        onPress={toggle}
        disabled={!hasDetails}
        dimWhenDisabled={false}
        accessibilityRole={hasDetails ? "button" : "text"}
        accessibilityState={hasDetails ? { expanded } : undefined}
        accessibilityLabel={`${step.label}. ${STEP_LABELS[displayState]}`}
        style={styles.stepHeading}
      >
        <Icon
          name={STEP_ICONS[displayState]}
          size={16}
          color={displayState === "failed" ? "red" : "secondaryLabel"}
        />
        <Text variant="subhead" weight="medium" style={styles.stepName}>
          {step.label}
        </Text>
        <Text variant="caption1" tone="secondary">
          {STEP_LABELS[displayState]}
        </Text>
        {hasDetails ? (
          <Icon name={expanded ? "chevron-up" : "chevron-down"} size={16} color="secondaryLabel" />
        ) : null}
      </Touchable>
      <View style={styles.stepBody}>
        {step.failure ? (
          <Text variant="footnote" tone="red" selectable>
            {step.failure.message}
            {step.failure.nextAction ? ` ${step.failure.nextAction}` : ""}
          </Text>
        ) : null}
        {expanded ? <StartupStepDetails attemptId={attemptId} step={step} /> : null}
      </View>
    </View>
  );
}

function StartupStepDetails({
  attemptId,
  step,
}: {
  attemptId: string;
  step: StartupStep;
}): ReactElement {
  return (
    <View style={styles.details}>
      {step.details.map((detail) => (
        <Text key={detail} variant="footnote" tone="secondary" selectable>
          {detail}
        </Text>
      ))}
      {step.resources?.map((resource) => (
        <Text key={`${resource.kind}:${resource.value}`} variant="monoSmall" selectable>
          {resource.kind}: {resource.value} · {resource.state}
          {resource.nextAction ? `\n${resource.nextAction}` : ""}
        </Text>
      ))}
      {step.action ? (
        <>
          <Text variant="monoSmall" selectable>
            {step.action.command}
          </Text>
          {step.action.terminalId ? (
            <StartupTerminalOutput attemptId={attemptId} terminalId={step.action.terminalId} />
          ) : null}
          {step.action.result ? (
            <>
              <Text
                variant="footnote"
                tone={terminalCommandSucceeded(step.action.result) ? "secondary" : "red"}
              >
                {terminalCommandResultLabel(step.action.result)}
              </Text>
              <Text variant="monoSmall" selectable>
                {step.action.result.outputTail.join("\n")}
              </Text>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  step: { minWidth: 0 },
  line: {
    position: "absolute",
    left: 7.5,
    top: theme.touchTarget / 2 + 8,
    bottom: -theme.touchTarget / 2 + 8,
    width: 1,
    backgroundColor: theme.desktop.border,
  },
  stepBody: { paddingLeft: 24, gap: theme.space.xs },
  stepHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: theme.touchTarget,
  },
  stepName: { flex: 1, minWidth: 0 },
  details: { gap: theme.space.xs, paddingBottom: theme.space.sm },
}));

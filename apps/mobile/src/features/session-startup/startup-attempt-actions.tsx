import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import {
  canOpenStartupSession,
  startupIsPending,
} from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button, type ButtonProps } from "@/ui/button";
import { useOpenStartupSession } from "./use-open-startup-session";

type StartupAttemptActionsProps = {
  attempt: StartupAttempt;
  onContinueInBackground?: (() => void) | undefined;
  onEditChoices?: (() => void) | undefined;
  onRepairSavedSession?: (() => void) | undefined;
  progressExpanded: boolean;
  onToggleProgress?: (() => void) | undefined;
};

export function StartupAttemptActions(props: StartupAttemptActionsProps): ReactElement | null {
  const connection = useClientConnection();
  const openSession = useOpenStartupSession();
  const actions = startupActionButtons(props, () =>
    connection.startupAttempts.dismiss(props.attempt.id),
  );
  const saved = props.attempt.ownership.state === "saved";
  if (actions.length === 0 && !saved) return null;
  return (
    <View style={styles.footer}>
      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="outline"
              size="sm"
              style={styles.action}
              {...action}
            />
          ))}
        </View>
      ) : null}
      {saved ? (
        <Button
          label="Open session"
          icon="arrow-up-right"
          variant="filled"
          size="md"
          onPress={() => openSession(props.attempt.id)}
          disabled={!canOpenStartupSession(props.attempt)}
          fill
        />
      ) : null}
    </View>
  );
}

function startupActionButtons(
  {
    attempt,
    onContinueInBackground,
    onEditChoices,
    onRepairSavedSession,
    progressExpanded,
    onToggleProgress,
  }: StartupAttemptActionsProps,
  dismiss: () => void,
): ButtonProps[] {
  const phase = attempt.status.phase;
  const running = startupIsPending(attempt);
  const actions: ButtonProps[] = [];
  if (onToggleProgress && attempt.presentation !== "notification")
    actions.push({
      label: progressExpanded ? "Hide progress" : "View progress",
      trailingIcon: progressExpanded ? "chevron-up" : "chevron-down",
      variant: "plain",
      onPress: onToggleProgress,
    });
  if (running) {
    if (onContinueInBackground)
      actions.push({
        label: "Continue in background",
        icon: "layers",
        variant: "plain",
        onPress: onContinueInBackground,
      });
  } else {
    for (const action of attempt.recoveryActions ?? [])
      actions.push({
        label: action.label,
        command: true,
        onPress: () => {
          void action.run();
        },
      });
    if (attempt.ownership.state === "not_saved" && onEditChoices)
      actions.push({ label: "Edit choices", onPress: onEditChoices });
    if (phase === "failed" && attempt.ownership.state === "saved" && onRepairSavedSession)
      actions.push({ label: "Retry preparation", command: true, onPress: onRepairSavedSession });
    if (attempt.presentation === "inline")
      actions.push({
        label: "Dismiss",
        variant: "plain",
        onPress: dismiss,
      });
  }
  return actions;
}

const styles = StyleSheet.create((theme) => ({
  footer: {
    flexShrink: 0,
    gap: theme.space.sm,
    paddingTop: theme.space.sm,
    borderTopWidth: theme.hairline,
    borderTopColor: theme.desktop.border,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  action: { minHeight: theme.touchTarget },
}));

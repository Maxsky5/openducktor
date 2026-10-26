import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/ui/button";

export function StartupAttemptActions({
  attempt,
  onContinueInBackground,
  onEditChoices,
  onRepairSavedSession,
}: {
  attempt: StartupAttempt;
  onContinueInBackground?: (() => void) | undefined;
  onEditChoices?: (() => void) | undefined;
  onRepairSavedSession?: (() => void) | undefined;
}): ReactElement {
  const connection = useClientConnection();
  const attemptId = attempt.id;
  const phase = attempt.status.phase;
  const running = startupIsPending(attempt);
  return (
    <View style={styles.actions}>
      {!running
        ? attempt.recoveryActions?.map((action) => (
            <Button
              key={action.kind}
              label={action.label}
              variant="outline"
              command
              onPress={() => {
                void action.run();
              }}
            />
          ))
        : null}
      {!running && attempt.ownership.state === "not_saved" && onEditChoices ? (
        <Button label="Edit choices" variant="outline" onPress={onEditChoices} />
      ) : null}
      {!running &&
      phase === "failed" &&
      attempt.ownership.state === "saved" &&
      onRepairSavedSession ? (
        <Button
          label="Retry preparation"
          variant="outline"
          command
          onPress={onRepairSavedSession}
        />
      ) : null}
      {running && onContinueInBackground ? (
        <Button
          label="Continue in background"
          variant="outline"
          onPress={onContinueInBackground}
          fill
        />
      ) : null}
      {!running && attempt.presentation !== "dialog" ? (
        <Button
          label="Dismiss"
          variant="plain"
          size="sm"
          onPress={() => connection.startupAttempts.dismiss(attemptId)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
}));

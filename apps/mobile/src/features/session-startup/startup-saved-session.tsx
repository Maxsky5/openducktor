import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { canOpenStartupSession } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/ui/button";
import { Text } from "@/ui/text";
import { useStartupPresentation } from "./startup-presentation-context";
import { useOpenStartupSession } from "./use-open-startup-session";

export function StartupSavedSession({ attempt }: { attempt: StartupAttempt }): ReactElement | null {
  const presentation = useStartupPresentation();
  const openSession = useOpenStartupSession();
  const attemptId = attempt.id;
  const inspectOpen = presentation.expanded[attemptId]?.has("saved-record") === true;
  if (attempt.ownership.state !== "saved") return null;
  return (
    <View style={styles.saved}>
      <Button
        label={inspectOpen ? "Hide saved session" : "Inspect saved session"}
        variant="plain"
        size="sm"
        onPress={() => presentation.toggle(attemptId, "saved-record")}
      />
      {inspectOpen ? (
        <View style={styles.details}>
          <Text variant="monoSmall" selectable>
            Saved session:{" "}
            {attempt.ownership.target.kind === "workspace"
              ? attempt.ownership.target.record.id
              : attempt.ownership.target.record.externalSessionId}
          </Text>
          <Text variant="monoSmall" selectable>
            Runtime: {attempt.ownership.target.record.runtimeKind}
          </Text>
          <Text variant="monoSmall" selectable>
            Native session: {attempt.ownership.target.record.externalSessionId ?? "Not prepared"}
          </Text>
          <Text variant="monoSmall" selectable>
            Directory:{" "}
            {attempt.ownership.target.kind === "workspace"
              ? attempt.ownership.target.record.executionTarget.workingDirectory
              : attempt.ownership.target.record.workingDirectory}
          </Text>
        </View>
      ) : null}
      <Button
        label="Open session"
        variant="outline"
        size="sm"
        onPress={() => openSession(attemptId)}
        disabled={!canOpenStartupSession(attempt)}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  saved: { gap: theme.space.sm },
  details: { gap: theme.space.sm, paddingVertical: theme.space.sm },
}));

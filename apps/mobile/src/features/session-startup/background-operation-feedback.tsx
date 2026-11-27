import type { BackgroundOperationStep } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  backgroundOperationStatus,
  backgroundStepStatus,
  canFinishClosingTask,
} from "@openducktor/frontend-core/operations/background-operation-presentation";
import {
  backgroundAttemptOrigin,
  type BackgroundAttempt,
} from "@openducktor/frontend-core/operations/background-operation-store";
import { useBackgroundAttempts } from "@openducktor/frontend-core/operations/use-background-attempts";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useStore } from "zustand";
import { useFeedbackStore } from "@/app-shell/app-services";
import { startupCoveredBy } from "@/feedback/feedback-store";
import { routes } from "@/navigation/routes";
import { Button } from "@/ui/button";
import { InPlaceSheet } from "@/ui/in-place-sheet";
import { Text } from "@/ui/text";

export function BackgroundOperationCard({ attempt }: { attempt: BackgroundAttempt }) {
  const { backgroundOperations } = useClientConnection();
  return (
    <View style={styles.content} accessibilityLiveRegion="polite">
      <Text variant="headline">
        {attempt.action} · {backgroundOperationStatus[attempt.phase]}
      </Text>
      <Text variant="footnote" tone="secondary">
        {backgroundAttemptOrigin(attempt)}
      </Text>
      {attempt.progress?.steps.map((step) => (
        <OperationStep key={step.id} step={step} />
      ))}
      {attempt.phase === "unconfirmed" ? <Text variant="footnote">{attempt.message}</Text> : null}
      {attempt.phase !== "running" ? (
        <Button
          label="Dismiss"
          variant="outline"
          size="sm"
          onPress={() => backgroundOperations.dismissToast(attempt.id)}
        />
      ) : null}
    </View>
  );
}

function OperationStep({ step, detailed }: { step: BackgroundOperationStep; detailed?: boolean }) {
  return (
    <View style={styles.step}>
      <Text variant="footnote" tone={step.state === "failed" ? "red" : "secondary"}>
        {step.label} · {backgroundStepStatus[step.state]}
      </Text>
      {detailed ? (
        <>
          {step.details.map((detail) => (
            <Text key={detail} variant="footnote">
              {detail}
            </Text>
          ))}
          {step.resources?.map((resource) => (
            <Text key={`${resource.kind}:${resource.value}`} variant="footnote" tone="secondary">
              {resource.state === "removed" ? "Removed " : ""}
              {resource.value}
            </Text>
          ))}
          {step.failure ? (
            <Text variant="footnote" tone="red">
              {step.failure.message}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export function BackgroundOperationResults() {
  const { backgroundOperations } = useClientConnection();
  const feedback = useFeedbackStore();
  const covered = useStore(
    feedback.store,
    (state) => startupCoveredBy(state) || state.nativeModalCount > 0,
  );
  const next = useBackgroundAttempts().find(
    (attempt) => attempt.phase === "failed" && !attempt.failureDismissed,
  );
  const router = useRouter();
  const [showing, setShowing] = useState<BackgroundAttempt>();
  const [closing, setClosing] = useState<"dismiss" | "finish">();
  useEffect(() => {
    if (!showing && !covered && next) setShowing(next);
  }, [covered, next, showing]);
  if (!showing) return null;
  const { id, target, workspace, progress } = showing;
  const steps = progress?.steps ?? [];
  return (
    <InPlaceSheet
      title={`${showing.action} failed`}
      visible={!closing}
      onClose={() => setClosing("dismiss")}
      onDismiss={() => {
        backgroundOperations.dismissFailure(id);
        setShowing(undefined);
        setClosing(undefined);
        if (closing === "finish" && target.kind === "task")
          router.push(routes.task(workspace.workspaceId, target.taskId, "close"));
      }}
      footer={
        target.kind === "task" && canFinishClosingTask(showing) ? (
          <Button
            label="Finish closing task"
            variant="filled"
            size="lg"
            fill
            onPress={() => setClosing("finish")}
          />
        ) : undefined
      }
    >
      <Text tone="secondary">{backgroundAttemptOrigin(showing)}</Text>
      {steps.map((step) => (
        <OperationStep key={step.id} step={step} detailed />
      ))}
      {showing.message && !steps.some((step) => step.failure?.message === showing.message) ? (
        <Text tone="red">{showing.message}</Text>
      ) : null}
      {progress?.phase === "failed" ? <Text>{progress.failure.nextAction}</Text> : null}
    </InPlaceSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.space.xs, padding: theme.space.md },
  step: { gap: theme.space.xxs },
}));

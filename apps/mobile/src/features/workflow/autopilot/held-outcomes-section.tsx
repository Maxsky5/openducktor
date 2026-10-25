import {
  AUTOPILOT_FAILURE_TITLE,
  AUTOPILOT_RETRY_MESSAGE_LABEL,
} from "@openducktor/frontend-core/autopilot/autopilot-outcome-copy";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/callout";
import { SectionHeader } from "@/ui/surfaces";
import { useHeldOutcomes } from "./use-held-outcomes";

/** The held Autopilot failures and skips of a task. It renders nothing when the host holds none. */
export function HeldOutcomesSection({
  workspaceId,
  taskId,
}: {
  workspaceId: string;
  taskId: string;
}): ReactElement | null {
  const { items, failure, error, retry, reload } = useHeldOutcomes(workspaceId, taskId);
  if (items.length === 0 && !failure && !error) return null;
  return (
    <View>
      <SectionHeader title="Autopilot" />
      <View style={styles.list}>
        {error ? (
          <Callout
            tone="destructive"
            title="Autopilot outcomes did not load"
            message={error}
            action={<Button label="Try Again" size="sm" variant="gray" onPress={reload} />}
          />
        ) : null}
        {failure ? (
          <Callout tone="warning" title={AUTOPILOT_FAILURE_TITLE} message={failure} />
        ) : null}
        {items.map((item) => (
          <View key={item.outcome.outcomeId} style={styles.item}>
            <Callout
              tone={item.outcome.kind === "skipped" ? "info" : "destructive"}
              title={item.title}
              message={item.description}
              action={
                item.canRetry ? (
                  <Button
                    label={AUTOPILOT_RETRY_MESSAGE_LABEL}
                    size="sm"
                    variant="gray"
                    loading={item.isRetrying}
                    command
                    onPress={() => retry(item.outcome.outcomeId)}
                  />
                ) : undefined
              }
            />
            {item.note ? (
              <Callout tone={item.note.tone} title={item.note.title} message={item.note.message} />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { paddingHorizontal: theme.layout.screenPadding, gap: theme.space.sm },
  item: { gap: theme.space.xs },
}));

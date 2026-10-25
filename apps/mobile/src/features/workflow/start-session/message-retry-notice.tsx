import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { type ReactElement, useSyncExternalStore } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/callout";
import { messageRetryStoreOf } from "./message-retry-store";

/**
 * The first messages of a task that did not reach their started sessions, each with Retry
 * message. The message never sends again without the user, and never after a lost result.
 */
export function MessageRetryNotices({ taskId }: { taskId: string }): ReactElement | null {
  const connection = useClientConnection();
  const store = messageRetryStoreOf(connection);
  const entries = useSyncExternalStore(
    store.subscribe,
    () => store.forTask(taskId),
    () => store.forTask(taskId),
  );
  if (entries.length === 0) return null;
  return (
    <View style={styles.list}>
      {entries.map((entry) => (
        <Callout
          key={entry.id}
          tone={entry.retry.kind === "unknown" ? "warning" : "destructive"}
          title={entry.retry.title}
          message={entry.retry.description}
          action={
            <>
              {entry.retry.kind === "failed" ? (
                <Button
                  label={entry.retry.actionLabel}
                  size="sm"
                  variant="gray"
                  loading={entry.pending}
                  command
                  onPress={() => void store.retry(entry.id)}
                />
              ) : null}
              <Button
                label="Dismiss"
                size="sm"
                variant="plain"
                disabled={entry.pending}
                onPress={() => store.dismiss(entry.id)}
              />
            </>
          }
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.md,
  },
}));

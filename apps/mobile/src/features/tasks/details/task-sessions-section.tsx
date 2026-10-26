import { formatElapsedAgo, useMinuteClock } from "@openducktor/frontend-core/lib/relative-time";
import { useRouter } from "expo-router";
import { memo, type ReactElement } from "react";
import { ActivityIndicator, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { routes, sessionParams } from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { Badge } from "@/ui/badge";
import { RoleTile, RuntimeIcon } from "@/ui/brand-icons";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { DetailsCard, DetailsCount, DetailsItem, DetailsNote } from "./details-card";
import type { TaskSessionGroup } from "./task-sessions-model";

/**
 * The task-bound sessions of a task in Workflow Role order, newest first. Each item shows the
 * name of the session history, such as "Builder #2", the runtime mark, the start time, and a
 * status that needs attention. Selecting an item opens the session. It renders again only when
 * its sessions change, not when another task of the workspace does.
 */
export const TaskSessionsSection = memo(function TaskSessionsSection({
  workspaceId,
  taskTitle,
  groups,
  isLoading,
  error,
  collapsed,
  onToggle,
}: {
  workspaceId: string;
  /** The navigation bar of the session shows the task title from the first frame. */
  taskTitle: string;
  groups: readonly TaskSessionGroup[];
  isLoading: boolean;
  error: string | null;
  collapsed: boolean;
  onToggle: () => void;
}): ReactElement {
  const router = useRouter();
  const theme = useAppTheme();
  const now = useMinuteClock();
  const count = groups.reduce((total, group) => total + group.rows.length, 0);
  return (
    <View>
      <DetailsCard
        title="Sessions"
        icon="messages-square"
        trailing={count > 0 ? <DetailsCount value={String(count)} /> : null}
        collapsed={collapsed}
        onToggle={onToggle}
      >
        {count === 0 ? (
          <DetailsNote
            text={isLoading ? "Loading sessions…" : "No session has started for this task."}
            leading={
              isLoading ? (
                <ActivityIndicator size="small" color={theme.desktop.mutedForeground} />
              ) : null
            }
          />
        ) : null}
        {groups.flatMap((group) =>
          group.rows.map((row) => {
            const started = formatElapsedAgo(now - Date.parse(row.startedAt));
            const name = row.label;
            return (
              <DetailsItem
                key={row.key}
                leading={<RoleTile role={group.role} />}
                trailing={
                  row.statusTone === "neutral" ? null : (
                    <Badge label={row.statusLabel} tone={row.statusTone} dot={row.live} />
                  )
                }
                accessibilityLabel={`${name}, ${row.statusLabel}, ${row.runtimeLabel}, started ${started}`}
                accessibilityHint="Opens the session."
                onPress={() =>
                  router.push(
                    routes.session({
                      ...sessionParams(workspaceId, row.identity),
                      title: taskTitle,
                      task: "1",
                    }),
                  )
                }
              >
                <Text variant="subhead" weight="semibold" numberOfLines={1} style={styles.title}>
                  {name}
                </Text>
                <View style={styles.meta}>
                  <RuntimeIcon runtimeKind={row.identity.runtimeKind} size={12} />
                  <Text variant="footnote" numberOfLines={1} style={styles.muted}>
                    {started}
                  </Text>
                </View>
              </DetailsItem>
            );
          }),
        )}
      </DetailsCard>
      {error ? (
        <View style={styles.notice}>
          <Callout
            tone="warning"
            title="Session history did not load"
            message={`${error} Live sessions still show. Pull to refresh.`}
          />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  title: { color: theme.desktop.foreground },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  muted: { flexShrink: 1, color: theme.desktop.mutedForeground },
  notice: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.space.sm },
}));

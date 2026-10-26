import type { TaskCard } from "@openducktor/contracts";
import { useRouter } from "expo-router";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { routes } from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { DetailsCard } from "./details-card";
import { taskDocumentsSummary } from "./task-details-model";

/** One work view of the task, as a desktop tool tab: its icon, its name, and a summary. */
function WorkRow({
  title,
  icon,
  value,
  first,
  onPress,
}: {
  title: string;
  icon: IconName;
  value?: string | null | undefined;
  first: boolean;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="highlight"
      onPress={onPress}
      radius={theme.radius.sm}
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}, ${value}` : title}
      accessibilityHint={`Opens the ${title} view of the task.`}
      style={styles.row}
    >
      {first ? null : <View style={styles.separator} />}
      <View style={styles.tile}>
        <Icon name={icon} size={16} colorValue={theme.desktop.foreground} />
      </View>
      <Text variant="body" weight="medium" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {value ? (
        <Text variant="footnote" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      <Icon name="chevron-right" size={15} colorValue={theme.desktop.mutedForeground} />
    </Touchable>
  );
}

/**
 * The work views of a task, as the desktop tool tabs: Changes, Files, Documents, CI, Terminals.
 * It renders again only when its task changes, not when another task of the workspace does.
 */
export const TaskWorkLinks = memo(function TaskWorkLinks({
  workspaceId,
  task,
  collapsed,
  onToggle,
}: {
  workspaceId: string;
  task: TaskCard;
  collapsed: boolean;
  onToggle: () => void;
}): ReactElement {
  const router = useRouter();
  const owner = { workspaceId, taskId: task.id };
  return (
    <DetailsCard title="Work" icon="wrench" collapsed={collapsed} onToggle={onToggle}>
      <View style={styles.list}>
        <WorkRow
          first
          title="Changes"
          icon="file-diff"
          onPress={() => router.push(routes.changes(owner))}
        />
        <WorkRow
          first={false}
          title="Files"
          icon="folder-tree"
          onPress={() => router.push(routes.files(owner))}
        />
        <WorkRow
          first={false}
          title="Artifacts"
          icon="files"
          value={taskDocumentsSummary(task.artifactSummary)}
          onPress={() => router.push(routes.artifacts(workspaceId, task.id))}
        />
        <WorkRow
          first={false}
          title="CI Checks"
          icon="list-checks"
          onPress={() => router.push(routes.checks(workspaceId, task.id))}
        />
        <WorkRow
          first={false}
          title="Terminals"
          icon="terminal"
          onPress={() => router.push(routes.terminals(owner))}
        />
      </View>
    </DetailsCard>
  );
});

const styles = StyleSheet.create((theme) => ({
  list: { marginHorizontal: -4 },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.sm,
  },
  separator: {
    position: "absolute",
    top: 0,
    right: theme.space.sm,
    left: theme.space.sm + 30 + theme.space.md,
    height: theme.hairline,
    backgroundColor: theme.desktop.border,
  },
  tile: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  title: { flex: 1, color: theme.desktop.foreground },
  value: { maxWidth: "50%", color: theme.desktop.mutedForeground },
}));

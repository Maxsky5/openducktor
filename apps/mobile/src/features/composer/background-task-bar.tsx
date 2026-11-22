import { plural } from "@openducktor/frontend-core/lib/plural";
import {
  BACKGROUND_TASKS_LABEL,
  type BackgroundTaskRow,
} from "@openducktor/frontend-core/sessions/background-tasks/background-task-bar";
import type { SessionBackgroundTasksModel } from "@openducktor/frontend-core/sessions/background-tasks/use-session-background-tasks";
import { memo, type ReactElement, useState } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { MONO_TYPE, monoWeight } from "@/theme/tokens";
import { type Confirm, useConfirm } from "@/ui/confirm-dialog";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { confirmBackgroundTaskStop } from "./background-task-bar-state";
import {
  COMPOSER_EDGE_LINE_HEIGHT,
  composerEdgeCardStyle,
  composerEdgeTextStyle,
} from "./composer-edge-card";
import { ComposerTextButton } from "./composer-controls";

/**
 * The running background tasks of the session on the top edge of the composer, as the desktop
 * bar: a still hourglass and the task count. It shows only while a task runs. A press opens the
 * list of tasks, oldest first, with the kind, the text, and Stop of each task. Stop asks first and
 * sends a host command, so it waits for the command gate.
 */
// The composer renders on each keystroke, and both props stay the same between keystrokes.
export const BackgroundTaskBar = memo(function BackgroundTaskBar({
  model,
  commandsOpen,
}: {
  model: SessionBackgroundTasksModel | null;
  commandsOpen: boolean;
}): ReactElement | null {
  return model ? <BackgroundTaskBarView model={model} commandsOpen={commandsOpen} /> : null;
});

function BackgroundTaskBarView({
  model,
  commandsOpen,
}: {
  model: SessionBackgroundTasksModel;
  commandsOpen: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const { rows, onStop } = model;
  const count = plural(rows.length, "background task");
  return (
    <View style={styles.bar}>
      <Touchable
        feedback="opacity"
        onPress={() => setExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={`${BACKGROUND_TASKS_LABEL}, ${count}`}
        accessibilityHint={
          expanded ? "Hides the background tasks." : "Shows each background task and its Stop."
        }
        accessibilityState={{ expanded }}
        style={styles.header}
      >
        <Icon name="hourglass" size={14} colorValue={theme.desktop.pendingMuted} />
        <Text style={styles.label}>{BACKGROUND_TASKS_LABEL}</Text>
        <Text numberOfLines={1} style={styles.count}>
          {count}
        </Text>
        <Icon
          name={expanded ? "chevron-up" : "chevron-down"}
          size={14}
          colorValue={theme.desktop.mutedForeground}
        />
      </Touchable>
      {expanded ? (
        // The list gives up height before the composer card, so the field stays above the keyboard.
        <ScrollView
          keyboardShouldPersistTaps="always"
          style={styles.list}
          contentContainerStyle={styles.listContent}
        >
          {/* The rows keep the order of their tasks; a key per task keeps the rows that stay. */}
          {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
          {rows.map((row) => (
            <BackgroundTaskItem
              key={row.taskId}
              row={row}
              commandsOpen={commandsOpen}
              confirm={confirm}
              onStop={onStop}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

/**
 * One background task: its kind, its text on one line, and its description. A press on the text
 * shows all of it. Stop shows Stopping until the task ends, and a failure shows its reason.
 */
const BackgroundTaskItem = memo(function BackgroundTaskItem({
  row,
  commandsOpen,
  confirm,
  onStop,
}: {
  row: BackgroundTaskRow;
  commandsOpen: boolean;
  confirm: Confirm;
  onStop: (taskId: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const { control, note } = row.stop;
  return (
    <View style={styles.row}>
      <View style={styles.grow}>
        <Touchable
          feedback="opacity"
          onPress={() => setOpen((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={[row.kindLabel, row.title, row.description]
            .filter(Boolean)
            .join(", ")}
          accessibilityHint={open ? "Shows less of the task." : "Shows the whole task."}
          accessibilityState={{ expanded: open }}
        >
          <Text variant="caption2" weight="medium" style={styles.kind}>
            {row.kindLabel}
          </Text>
          <Text
            numberOfLines={open ? undefined : 1}
            style={row.kind === "command" ? styles.command : styles.title}
          >
            {row.title}
          </Text>
          {row.description ? (
            <Text variant="footnote" numberOfLines={open ? undefined : 1} style={styles.muted}>
              {row.description}
            </Text>
          ) : null}
        </Touchable>
        {note ? (
          <Text
            variant="footnote"
            selectable
            accessibilityRole={note.tone === "error" ? "alert" : undefined}
            style={note.tone === "error" ? styles.error : styles.muted}
          >
            {note.text}
          </Text>
        ) : null}
      </View>
      {control ? (
        <ComposerTextButton
          label={control.label}
          icon="square"
          variant="outline"
          busy={control.busy}
          disabled={!commandsOpen}
          accessibilityLabel={`${control.label} ${row.kindLabel.toLowerCase()} ${row.title}`}
          onPress={() => void confirmBackgroundTaskStop(confirm, row, onStop)}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  bar: { flexShrink: 1, ...composerEdgeCardStyle(theme) },
  header: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  label: composerEdgeTextStyle(theme, "medium", theme.desktop.foreground),
  count: {
    flex: 1,
    minWidth: 0,
    ...composerEdgeTextStyle(theme, "regular", theme.desktop.mutedForeground),
  },
  list: { flexShrink: 1, marginTop: theme.space.xs },
  listContent: { gap: theme.space.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingVertical: theme.space.xs,
    borderTopWidth: 1,
    borderTopColor: theme.desktop.border,
  },
  grow: { flex: 1, minWidth: 0 },
  kind: { color: theme.desktop.mutedForeground },
  title: composerEdgeTextStyle(theme, "regular", theme.desktop.foreground),
  command: {
    ...monoWeight("regular"),
    ...MONO_TYPE.monoSmall,
    lineHeight: COMPOSER_EDGE_LINE_HEIGHT,
    color: theme.desktop.foreground,
  },
  muted: { color: theme.desktop.mutedForeground },
  error: { color: theme.desktop.destructive },
}));

import type { ReactElement } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { SessionWorkflowRail } from "../header/session-workflow-rail";
import { useSessionTarget } from "../session-target";
import { SessionTodosPanel, useVisibleSessionTodos } from "./session-todos-panel";

/** The side panel of a low window, such as a phone in landscape, leaves the transcript most width. */
const COMPACT_WIDTH = 232;
const WIDE_WIDTH = 320;

/**
 * The side panel of a low or wide window: the workflow rail of a task session as a column, then
 * the Session Todos. The transcript keeps the height that the rail takes under the navigation
 * bar in portrait. The panel shows only with content, so a chat without todos keeps the whole
 * width for its transcript.
 */
export function SessionSidePanel({ compact }: { compact: boolean }): ReactElement | null {
  const { owner, readOnly, workspace, repoPath } = useSessionTarget();
  const todos = useVisibleSessionTodos();
  const { bottom } = useSafeAreaInsets();
  const rail = owner.kind === "task" && !readOnly ? owner : null;
  if (!rail && todos.length === 0) return null;
  return (
    <>
      <View style={styles.divider} />
      <View
        style={[
          styles.panel,
          { width: compact ? COMPACT_WIDTH : WIDE_WIDTH, paddingBottom: bottom },
        ]}
        accessibilityRole="summary"
      >
        {rail ? (
          <ScrollView style={styles.workflow}>
            <SessionWorkflowRail
              workspaceId={workspace.workspaceId}
              repoPath={repoPath}
              taskId={rail.taskId}
              role={rail.role}
              orientation="column"
            />
          </ScrollView>
        ) : null}
        <SessionTodosPanel variant="side" />
      </View>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  divider: { width: theme.hairline, backgroundColor: theme.colors.separator },
  panel: { backgroundColor: theme.colors.groupedBackground },
  workflow: { flexGrow: 0, flexShrink: 1 },
}));

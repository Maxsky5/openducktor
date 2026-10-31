import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { useRouter } from "expo-router";
import { memo, type ReactElement, useCallback, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SessionComposer } from "@/features/composer/session-composer";
import { routes, sessionParams } from "@/navigation/routes";
import { KeyboardInsetView } from "@/ui/keyboard-inset-view";
import { Screen } from "@/ui/screen";
import { useCompactHeight, useWideLayout } from "@/ui/use-wide-layout";
import { SessionHeader } from "./header/session-header";
import { SessionResumeNotice } from "./header/session-resume-notice";
import { SessionSidePanel } from "./panels/session-side-panel";
import { SessionTodosPanel } from "./panels/session-todos-panel";
import { SessionPendingInput } from "./pending-input/session-pending-input";
import { SessionRuntimeStatus } from "./session-runtime-status";
import { SessionGitConflict } from "./session-git-conflict";
import { SessionLoaders } from "./session-loaders";
import { useFocusPendingInput, useSessionTarget } from "./session-target";
import { LiveSessionTranscript, ReadOnlySessionTranscript } from "./session-transcript-source";
import { createJumpToLatestSignal } from "./transcript/jump-to-latest-signal";
import { usePublishVisibleSession } from "./use-publish-visible-session";
import { useSessionFork } from "./fork/session-fork";
import { useStartupAttempt } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { StartupTrace } from "@/features/session-startup/startup-trace";

/**
 * The session view. The navigation bar carries the session identity, status, and the work views,
 * and a task session shows its workflow rail under it. Below them: a Git Conflict and the
 * transcript. Above the composer, as the desktop bottom stack: the interrupted turn, pending
 * input, the auxiliary error and runtime status rows, and the todo panel. A phone in portrait
 * shows one column. A low or wide window, such as a phone in landscape, moves the workflow rail
 * and the todos to a side panel, so the transcript keeps the height. The column keeps its
 * children in the same order in both layouts, so a rotation keeps the transcript scroll position
 * and the composer text. It reads only the session target, so `memo` keeps a streamed token in
 * the screen above, and a change of the interaction, from rendering it.
 */
export const SessionView = memo(function SessionView(): ReactElement {
  const target = useSessionTarget();
  const fork = useSessionFork();
  const startup = useStartupAttempt(fork?.startupAttemptId);
  const focusPendingInput = useFocusPendingInput();
  const { readOnly, workspace } = target;
  const router = useRouter();
  // A low or wide window shows the workflow rail and the todos in a side panel.
  const wide = useWideLayout();
  const compact = useCompactHeight();
  const side = wide || compact;
  const [latestSignal] = useState(createJumpToLatestSignal);
  usePublishVisibleSession(target);
  const { workspaceId } = workspace;
  const openSubagent = useCallback(
    (identity: AgentSessionIdentity) =>
      router.push(routes.session({ ...sessionParams(workspaceId, identity), readOnly: "1" })),
    [router, workspaceId],
  );
  const onSent = latestSignal.emit;
  const Transcript = readOnly ? ReadOnlySessionTranscript : LiveSessionTranscript;

  return (
    <Screen>
      <View style={styles.row}>
        <View style={styles.main}>
          <SessionHeader showsRail={!side} />
          {startup?.presentation === "inline" ? (
            <View style={styles.startup}>
              <StartupTrace attemptId={startup.id} presentation="inline" />
            </View>
          ) : null}
          {readOnly ? null : <SessionGitConflict />}
          {/* A read-only session has no composer, so its column keeps the bottom safe area. */}
          <KeyboardInsetView
            style={styles.column}
            bottomSafeArea={readOnly}
            barSafeArea={!readOnly}
          >
            <View style={styles.transcript}>
              <Transcript latestSignal={latestSignal} onOpenSubagent={openSubagent} />
            </View>
            {readOnly ? null : <SessionResumeNotice />}
            {readOnly ? null : <SessionPendingInput focus={focusPendingInput} />}
            {readOnly ? null : <SessionLoaders />}
            <SessionRuntimeStatus />
            {side ? null : <SessionTodosPanel variant="inline" />}
            {readOnly ? null : <SessionComposer onSent={onSent} />}
          </KeyboardInsetView>
        </View>
        {side ? <SessionSidePanel compact={compact} /> : null}
      </View>
    </Screen>
  );
});

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row" },
  main: { flex: 1, minWidth: 0 },
  column: { flex: 1 },
  transcript: { flex: 1 },
  startup: { maxHeight: 280 },
});

import { matchesStartupScope } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import {
  type StartupAttempt,
  useStartupAttemptsSelector,
} from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import type { AgentSessionTranscriptTarget } from "@openducktor/frontend-core/sessions/transcript/agent-session-transcript-target";
import { useRouter } from "expo-router";
import { type ComponentRef, memo, type ReactElement, useCallback, useRef, useState } from "react";
import { ScrollView, TextInput, useWindowDimensions, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SessionComposer } from "@/features/composer/session-composer";
import { InlineStartupLease } from "@/features/session-startup/inline-startup-lease";
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
import {
  type SessionTarget,
  useFocusPendingInput,
  useRouteStartupAttemptId,
  useSessionTarget,
} from "./session-target";
import { LiveSessionTranscript, ReadOnlySessionTranscript } from "./session-transcript-source";
import { createJumpToLatestSignal } from "./transcript/jump-to-latest-signal";
import { PublishVisibleSession } from "./publish-visible-session";
import { useSessionFork } from "./fork/session-fork";

const MAX_INPUT_AREA_HEIGHT_SHARE = 0.62;

const matchesSessionAttempt = (attempt: StartupAttempt, target: SessionTarget): boolean => {
  if (target.owner.kind === "chat") {
    return matchesStartupScope(attempt, {
      kind: "workspace",
      workspaceId: target.workspace.workspaceId,
      sessionId: target.owner.record.id,
    });
  }
  if (target.owner.kind === "task") {
    return matchesStartupScope(attempt, {
      kind: "task",
      workspaceId: target.workspace.workspaceId,
      taskId: target.owner.taskId,
      role: target.owner.role,
    });
  }
  return false;
};

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
  const routeStartupAttemptId = useRouteStartupAttemptId();
  const preferredId = fork?.startupAttemptId ?? routeStartupAttemptId;
  const matchedStartupKey = useStartupAttemptsSelector(
    useCallback(
      (attempts) => {
        const matched =
          (preferredId ? attempts.find((attempt) => attempt.id === preferredId) : undefined) ??
          attempts.findLast((attempt) => matchesSessionAttempt(attempt, target)) ??
          null;
        return matched ? `${matched.id}\0${matched.presentation}` : null;
      },
      [preferredId, target],
    ),
  );
  const separator = matchedStartupKey?.indexOf("\0") ?? -1;
  const startupId =
    matchedStartupKey && separator !== -1 ? matchedStartupKey.slice(0, separator) : null;
  const inlineStartupId =
    matchedStartupKey && separator !== -1 && matchedStartupKey.slice(separator + 1) === "inline"
      ? startupId
      : null;
  const focusPendingInput = useFocusPendingInput();
  const { readOnly, workspace } = target;
  const router = useRouter();
  // A low or wide window shows the workflow rail and the todos in a side panel.
  const wide = useWideLayout();
  const compact = useCompactHeight();
  const side = wide || compact;
  const [latestSignal] = useState(createJumpToLatestSignal);
  const [availableHeight, setAvailableHeight] = useState(0);
  const { workspaceId } = workspace;
  const openSubagent = useCallback(
    ({ sessionScope, ...identity }: AgentSessionTranscriptTarget) => {
      const params = sessionParams(workspaceId, identity);
      params.readOnly = "1";
      if (sessionScope) params.transcriptScope = JSON.stringify(sessionScope);
      router.push(routes.session(params));
    },
    [router, workspaceId],
  );
  const onSent = latestSignal.emit;
  const Transcript = readOnly ? ReadOnlySessionTranscript : LiveSessionTranscript;

  return (
    <Screen>
      <PublishVisibleSession target={target} />
      <InlineStartupLease attemptId={startupId} />
      <View style={styles.row}>
        <View style={styles.main}>
          <SessionHeader showsRail={!side} />
          {readOnly ? null : <SessionGitConflict />}
          {/* A read-only session has no composer, so its column keeps the bottom safe area. */}
          <KeyboardInsetView
            style={styles.column}
            bottomSafeArea={readOnly}
            barSafeArea={!readOnly}
          >
            <View
              style={styles.column}
              onLayout={(event) => setAvailableHeight(event.nativeEvent.layout.height)}
            >
              <View style={styles.transcript}>
                <Transcript
                  latestSignal={latestSignal}
                  onOpenSubagent={openSubagent}
                  startupAttemptId={inlineStartupId}
                />
              </View>
              {readOnly ? (
                <>
                  <SessionRuntimeStatus />
                  {side ? null : <SessionTodosPanel variant="inline" />}
                </>
              ) : (
                <SessionInputArea
                  side={side}
                  availableHeight={availableHeight}
                  focusPendingInput={focusPendingInput}
                  onSent={onSent}
                />
              )}
            </View>
          </KeyboardInsetView>
        </View>
        {side ? <SessionSidePanel compact={compact} /> : null}
      </View>
    </Screen>
  );
});

/** The bottom stack scrolls as one unit when the keyboard leaves little room above it. */
function SessionInputArea({
  side,
  availableHeight,
  focusPendingInput,
  onSent,
}: {
  side: boolean;
  availableHeight: number;
  focusPendingInput: boolean;
  onSent: () => void;
}): ReactElement {
  const { height } = useWindowDimensions();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const focusedField = useRef<ReturnType<typeof TextInput.State.currentlyFocusedInput>>(null);
  const viewportHeight = useRef(0);
  const scrollY = useRef(0);
  const revealFocusedField = useCallback(() => {
    const field = focusedField.current;
    const scroll = scrollRef.current;
    const content = scroll?.getInnerViewRef();
    if (!field || !scroll || !content || viewportHeight.current === 0) return;
    field.measureLayout(content, (_x, y, _width, fieldHeight) => {
      if (field !== focusedField.current) return;
      const bottom = y + fieldHeight;
      // A fitting field stays fully visible. A taller field keeps the visible part in place.
      const start = Math.min(y, bottom - viewportHeight.current);
      const end = Math.max(y, bottom - viewportHeight.current);
      const nextY = Math.max(0, Math.min(Math.max(scrollY.current, start), end));
      if (nextY !== scrollY.current) {
        scroll.scrollTo({ y: nextY, animated: false });
      }
    });
  }, []);
  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.inputArea, { maxHeight: Math.round(height * MAX_INPUT_AREA_HEIGHT_SHARE) }]}
      keyboardShouldPersistTaps="handled"
      onLayout={(event) => {
        viewportHeight.current = event.nativeEvent.layout.height;
        revealFocusedField();
      }}
      onFocus={() => {
        focusedField.current = TextInput.State.currentlyFocusedInput();
        revealFocusedField();
      }}
      onBlur={() => {
        focusedField.current = null;
      }}
      onContentSizeChange={revealFocusedField}
      onScroll={(event) => {
        scrollY.current = event.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={16}
    >
      <SessionResumeNotice />
      <SessionPendingInput focus={focusPendingInput} scrollRef={scrollRef} />
      <SessionLoaders />
      <SessionRuntimeStatus />
      {side ? null : <SessionTodosPanel variant="inline" />}
      <SessionComposer onSent={onSent} availableHeight={availableHeight} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row" },
  main: { flex: 1, minWidth: 0 },
  column: { flex: 1 },
  transcript: { flex: 1 },
  inputArea: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
});

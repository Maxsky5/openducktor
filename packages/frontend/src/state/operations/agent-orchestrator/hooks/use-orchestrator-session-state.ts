import type { TaskCard } from "@openducktor/contracts";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type AgentSessionsStore, createAgentSessionsStore } from "@/state/agent-sessions-store";
import type { SessionHistoryCoverage } from "@/state/queries/agent-session-history-coverage";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { markSessionHistoriesStale } from "../history/session-history-freshness";
import { createSessionTurnState, type SessionTurnState } from "../support/session-turn-state";

type UseOrchestratorSessionStateRefs = {
  taskRef: MutableRefObject<TaskCard[]>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  sessionTurnState: SessionTurnState;
};

type UseOrchestratorSessionStateArgs = {
  workspaceRepoPath: string | null;
  tasks: TaskCard[];
  historyCoverage: SessionHistoryCoverage;
  flushTranscriptEvents: () => void;
};

type UseOrchestratorSessionStateResult = {
  sessionStore: AgentSessionsStore;
} & UseOrchestratorSessionStateRefs;

export const useOrchestratorSessionState = ({
  workspaceRepoPath,
  tasks,
  historyCoverage,
  flushTranscriptEvents,
}: UseOrchestratorSessionStateArgs): UseOrchestratorSessionStateResult => {
  const initialWorkspaceRepoPathRef = useRef(workspaceRepoPath);
  const sessionStore = useMemo(
    () => createAgentSessionsStore(initialWorkspaceRepoPathRef.current, historyCoverage),
    [historyCoverage],
  );
  const taskRef = useRef(tasks);
  const currentWorkspaceRepoPathRef = useRef<string | null>(workspaceRepoPath);
  const repoEpochRef = useRef(0);
  const sessionTurnState = useMemo(() => createSessionTurnState(), []);

  useEffect(() => {
    taskRef.current = tasks;
  }, [tasks]);

  useEffect(
    () =>
      historyCoverage.subscribeResets((repoPath) => {
        const currentRepoPath = currentWorkspaceRepoPathRef.current;
        if (currentRepoPath && normalizeWorkingDirectory(currentRepoPath) === repoPath) {
          // The rail can finish recovery after the selected attachment restored its collection.
          sessionStore.setSessionCollection(markSessionHistoriesStale);
        }
      }),
    [historyCoverage, sessionStore],
  );

  useLayoutEffect(() => {
    if (currentWorkspaceRepoPathRef.current === workspaceRepoPath) {
      return;
    }
    // Commit buffered events to the old workspace before its collection is retained.
    flushTranscriptEvents();
    repoEpochRef.current += 1;
    currentWorkspaceRepoPathRef.current = workspaceRepoPath;

    sessionTurnState.clearAll();
    sessionStore.resetWorkspace(workspaceRepoPath);
  }, [flushTranscriptEvents, sessionTurnState, workspaceRepoPath, sessionStore]);

  const clearMutableSessionState = useCallback(() => {
    sessionTurnState.clearAll();
  }, [sessionTurnState]);

  useEffect(() => clearMutableSessionState, [clearMutableSessionState]);

  return useMemo(
    () => ({
      sessionStore,
      taskRef,
      currentWorkspaceRepoPathRef,
      repoEpochRef,
      sessionTurnState,
    }),
    [sessionStore, sessionTurnState],
  );
};

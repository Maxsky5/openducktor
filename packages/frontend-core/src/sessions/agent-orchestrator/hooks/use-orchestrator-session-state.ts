import type { TaskCard } from "@openducktor/contracts";
import type { MutableRefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type AgentSessionsStore, createAgentSessionsStore } from "../../agent-sessions-store";
import type { SessionHistoryFreshnessTracker } from "../../../queries/agent-session-history-freshness-tracker";
import { normalizeWorkingDirectory } from "../../../lib/working-directory";
import { markSessionHistoriesStale } from "../history/session-history-freshness";
import { createSessionTurnState, type SessionTurnState } from "../support/session-turn-state";

type UseOrchestratorSessionStateArgs = {
  workspaceRepoPath: string | null;
  tasks: TaskCard[];
  historyFreshness: SessionHistoryFreshnessTracker;
  store?: AgentSessionsStore | undefined;
};

type UseOrchestratorSessionStateResult = {
  sessionStore: AgentSessionsStore;
  taskRef: MutableRefObject<TaskCard[]>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  sessionTurnState: SessionTurnState;
};

export const useOrchestratorSessionState = ({
  workspaceRepoPath,
  tasks,
  historyFreshness,
  store,
}: UseOrchestratorSessionStateArgs): UseOrchestratorSessionStateResult => {
  const [sessionStore] = useState(
    () => store ?? createAgentSessionsStore(workspaceRepoPath, historyFreshness),
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
      historyFreshness.subscribeWorkspaceResets((repoPath) => {
        const currentRepoPath = currentWorkspaceRepoPathRef.current;
        if (currentRepoPath && normalizeWorkingDirectory(currentRepoPath) === repoPath) {
          // Activity recovery can finish after this controller restores its collection.
          sessionStore.setSessionCollection(markSessionHistoriesStale);
        }
      }),
    [historyFreshness, sessionStore],
  );

  useEffect(() => {
    currentWorkspaceRepoPathRef.current = sessionStore.getActivitySnapshot().workspaceRepoPath;
    return () => {
      repoEpochRef.current += 1;
      currentWorkspaceRepoPathRef.current = null;
      sessionTurnState.clearAll();
    };
  }, [sessionStore, sessionTurnState]);

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

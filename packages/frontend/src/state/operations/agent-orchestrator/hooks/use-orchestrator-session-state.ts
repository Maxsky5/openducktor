import type { TaskCard } from "@openducktor/contracts";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type AgentSessionsStore, createAgentSessionsStore } from "@/state/agent-sessions-store";
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
};

type UseOrchestratorSessionStateResult = {
  sessionStore: AgentSessionsStore;
} & UseOrchestratorSessionStateRefs;

export const useOrchestratorSessionState = ({
  workspaceRepoPath,
  tasks,
}: UseOrchestratorSessionStateArgs): UseOrchestratorSessionStateResult => {
  const initialWorkspaceRepoPathRef = useRef(workspaceRepoPath);
  const sessionStore = useMemo(
    () => createAgentSessionsStore(initialWorkspaceRepoPathRef.current),
    [],
  );
  const taskRef = useRef(tasks);
  const currentWorkspaceRepoPathRef = useRef<string | null>(workspaceRepoPath);
  const repoEpochRef = useRef(0);
  const sessionTurnState = useMemo(() => createSessionTurnState(), []);

  useEffect(() => {
    taskRef.current = tasks;
  }, [tasks]);

  useLayoutEffect(() => {
    if (currentWorkspaceRepoPathRef.current === workspaceRepoPath) {
      return;
    }
    repoEpochRef.current += 1;
    currentWorkspaceRepoPathRef.current = workspaceRepoPath;

    sessionTurnState.clearAll();
    sessionStore.resetWorkspace(workspaceRepoPath);
  }, [sessionTurnState, workspaceRepoPath, sessionStore]);

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

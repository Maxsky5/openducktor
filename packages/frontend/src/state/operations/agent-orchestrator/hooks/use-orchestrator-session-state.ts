import type { TaskCard } from "@openducktor/contracts";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  createSessionStartGate,
  type SessionStartGate,
} from "@/features/session-start/session-start-gate";
import { type AgentSessionsStore, createAgentSessionsStore } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { createSessionObservers, type SessionObservers } from "../support/session-observers";
import { createSessionTurnState, type SessionTurnState } from "../support/session-turn-state";

type UseOrchestratorSessionStateRefs = {
  taskRef: MutableRefObject<TaskCard[]>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  sessionStartGateRef: MutableRefObject<SessionStartGate<AgentSessionIdentity>>;
  sessionObserversRef: MutableRefObject<SessionObservers>;
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
  const sessionStartGateRef = useRef(createSessionStartGate<AgentSessionIdentity>());
  const sessionObserversRef = useRef(createSessionObservers());
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

    sessionObserversRef.current.clear();
    sessionTurnState.clearAll();
    sessionStartGateRef.current.clear();
    sessionStore.resetWorkspace(workspaceRepoPath);
  }, [sessionTurnState, workspaceRepoPath, sessionStore]);

  const clearMutableSessionState = useCallback(() => {
    sessionObserversRef.current.clear();
    sessionTurnState.clearAll();
    sessionStartGateRef.current.clear();
  }, [sessionTurnState]);

  useEffect(() => clearMutableSessionState, [clearMutableSessionState]);

  return useMemo(
    () => ({
      sessionStore,
      taskRef,
      currentWorkspaceRepoPathRef,
      repoEpochRef,
      sessionStartGateRef,
      sessionObserversRef,
      sessionTurnState,
    }),
    [sessionStore, sessionTurnState],
  );
};

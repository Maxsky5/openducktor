import type { TaskCard } from "@openducktor/contracts";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  type AgentSessionsById,
  type AgentSessionsStore,
  createAgentSessionsStore,
} from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { DraftChannelValueMap, DraftSource } from "../events/session-event-types";
import type { AssistantTurnTimingState } from "../support/assistant-turn-duration";
import {
  clearSessionListenerRegistry,
  createSessionListenerRegistry,
  type SessionListenerRegistry,
} from "../support/session-listener-registry";

type SessionStateUpdater = AgentSessionsById | ((current: AgentSessionsById) => AgentSessionsById);

type OrchestratorMutableState = {
  sessionsById: AgentSessionsById;
  tasks: TaskCard[];
  currentWorkspaceRepoPath: string | null;
  repoEpoch: number;
  inFlightStartsByWorkspaceTask: Map<string, Promise<string>>;
  sessionListenerRegistry: SessionListenerRegistry;
  draftRawBySession: Record<string, DraftChannelValueMap<string>>;
  draftSourceBySession: Record<string, DraftChannelValueMap<DraftSource>>;
  draftMessageIdBySession: Record<string, DraftChannelValueMap<string>>;
  draftFlushTimeoutBySession: Record<string, ReturnType<typeof setTimeout> | undefined>;
  assistantTurnTimingBySession: Record<string, AssistantTurnTimingState>;
  turnModelBySession: Record<string, AgentSessionState["selectedModel"]>;
};

type OrchestratorRefBridges = {
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  taskRef: MutableRefObject<TaskCard[]>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  inFlightStartsByWorkspaceTaskRef: MutableRefObject<Map<string, Promise<string>>>;
  sessionListenerRegistryRef: MutableRefObject<SessionListenerRegistry>;
  draftRawBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<string>>>;
  draftSourceBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<DraftSource>>>;
  draftMessageIdBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<string>>>;
  draftFlushTimeoutBySessionRef: MutableRefObject<
    Record<string, ReturnType<typeof setTimeout> | undefined>
  >;
  assistantTurnTimingBySessionRef: MutableRefObject<Record<string, AssistantTurnTimingState>>;
  turnModelBySessionRef: MutableRefObject<Record<string, AgentSessionState["selectedModel"]>>;
};

type UseOrchestratorSessionStateArgs = {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
};

type UseOrchestratorSessionStateResult = {
  sessionsById: AgentSessionsById;
  sessionStore: AgentSessionsStore;
  refBridges: OrchestratorRefBridges;
  commitSessions: (updater: SessionStateUpdater) => void;
};

const createMutableBridge = <K extends keyof OrchestratorMutableState>(
  stateRef: MutableRefObject<OrchestratorMutableState>,
  key: K,
): MutableRefObject<OrchestratorMutableState[K]> =>
  ({
    get current() {
      return stateRef.current[key];
    },
    set current(value: OrchestratorMutableState[K]) {
      stateRef.current[key] = value;
    },
  }) as MutableRefObject<OrchestratorMutableState[K]>;

export const useOrchestratorSessionState = ({
  activeWorkspace,
  tasks,
}: UseOrchestratorSessionStateArgs): UseOrchestratorSessionStateResult => {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const initialWorkspaceRepoPathRef = useRef(workspaceRepoPath);
  const sessionStore = useMemo(
    () => createAgentSessionsStore(initialWorkspaceRepoPathRef.current),
    [],
  );
  const mutableStateRef = useRef<OrchestratorMutableState>({
    sessionsById: {},
    tasks,
    currentWorkspaceRepoPath: workspaceRepoPath,
    repoEpoch: 0,
    inFlightStartsByWorkspaceTask: new Map<string, Promise<string>>(),
    sessionListenerRegistry: createSessionListenerRegistry(),
    draftRawBySession: {},
    draftSourceBySession: {},
    draftMessageIdBySession: {},
    draftFlushTimeoutBySession: {},
    assistantTurnTimingBySession: {},
    turnModelBySession: {},
  });
  const refBridges = useMemo<OrchestratorRefBridges>(
    () => ({
      sessionsRef: createMutableBridge(mutableStateRef, "sessionsById"),
      taskRef: createMutableBridge(mutableStateRef, "tasks"),
      currentWorkspaceRepoPathRef: createMutableBridge(mutableStateRef, "currentWorkspaceRepoPath"),
      repoEpochRef: createMutableBridge(mutableStateRef, "repoEpoch"),
      inFlightStartsByWorkspaceTaskRef: createMutableBridge(
        mutableStateRef,
        "inFlightStartsByWorkspaceTask",
      ),
      sessionListenerRegistryRef: createMutableBridge(mutableStateRef, "sessionListenerRegistry"),
      draftRawBySessionRef: createMutableBridge(mutableStateRef, "draftRawBySession"),
      draftSourceBySessionRef: createMutableBridge(mutableStateRef, "draftSourceBySession"),
      draftMessageIdBySessionRef: createMutableBridge(mutableStateRef, "draftMessageIdBySession"),
      draftFlushTimeoutBySessionRef: createMutableBridge(
        mutableStateRef,
        "draftFlushTimeoutBySession",
      ),
      assistantTurnTimingBySessionRef: createMutableBridge(
        mutableStateRef,
        "assistantTurnTimingBySession",
      ),
      turnModelBySessionRef: createMutableBridge(mutableStateRef, "turnModelBySession"),
    }),
    [],
  );

  const commitSessions = useCallback(
    (updater: SessionStateUpdater): void => {
      const current = mutableStateRef.current.sessionsById;
      const next = typeof updater === "function" ? updater(current) : updater;
      mutableStateRef.current.sessionsById = next;

      sessionStore.setSessionsById(next);
    },
    [sessionStore],
  );

  useEffect(() => {
    mutableStateRef.current.tasks = tasks;
  }, [tasks]);

  useLayoutEffect(() => {
    if (mutableStateRef.current.currentWorkspaceRepoPath === workspaceRepoPath) {
      return;
    }
    mutableStateRef.current.repoEpoch += 1;
    mutableStateRef.current.currentWorkspaceRepoPath = workspaceRepoPath;

    clearSessionListenerRegistry(mutableStateRef.current.sessionListenerRegistry);
    for (const timeoutId of Object.values(mutableStateRef.current.draftFlushTimeoutBySession)) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
    mutableStateRef.current.draftRawBySession = {};
    mutableStateRef.current.draftSourceBySession = {};
    mutableStateRef.current.draftMessageIdBySession = {};
    mutableStateRef.current.draftFlushTimeoutBySession = {};
    mutableStateRef.current.assistantTurnTimingBySession = {};
    mutableStateRef.current.turnModelBySession = {};
    mutableStateRef.current.inFlightStartsByWorkspaceTask.clear();
    mutableStateRef.current.sessionsById = {};
    sessionStore.resetWorkspace(workspaceRepoPath);
  }, [workspaceRepoPath, sessionStore]);

  const clearMutableSessionState = useCallback(() => {
    clearSessionListenerRegistry(mutableStateRef.current.sessionListenerRegistry);
    for (const timeoutId of Object.values(mutableStateRef.current.draftFlushTimeoutBySession)) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
    mutableStateRef.current.inFlightStartsByWorkspaceTask.clear();
  }, []);

  useEffect(() => clearMutableSessionState, [clearMutableSessionState]);

  return useMemo(
    () => ({
      get sessionsById() {
        return sessionStore.getSessionsByIdSnapshot();
      },
      sessionStore,
      refBridges,
      commitSessions,
    }),
    [commitSessions, refBridges, sessionStore],
  );
};

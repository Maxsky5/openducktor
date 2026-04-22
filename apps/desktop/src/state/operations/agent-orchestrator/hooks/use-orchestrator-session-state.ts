import type { TaskCard } from "@openducktor/contracts";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  type AgentSessionsById,
  type AgentSessionsStore,
  createAgentSessionsStore,
} from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { DraftChannelValueMap, DraftSource } from "../events/session-event-types";
import type { AssistantTurnTimingState } from "../support/assistant-turn-duration";

type SessionStateUpdater = AgentSessionsById | ((current: AgentSessionsById) => AgentSessionsById);

type OrchestratorMutableState = {
  sessionsById: AgentSessionsById;
  tasks: TaskCard[];
  activeWorkspace: ActiveWorkspace | null;
  currentWorkspaceRepoPath: string | null;
  repoEpoch: number;
  inFlightStartsByWorkspaceTask: Map<string, Promise<string>>;
  unsubscribersBySession: Map<string, () => void>;
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
  activeWorkspaceRef: MutableRefObject<ActiveWorkspace | null>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  inFlightStartsByWorkspaceTaskRef: MutableRefObject<Map<string, Promise<string>>>;
  unsubscribersRef: MutableRefObject<Map<string, () => void>>;
  draftRawBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<string>>>;
  draftSourceBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<DraftSource>>>;
  draftMessageIdBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<string>>>;
  draftFlushTimeoutBySessionRef: MutableRefObject<
    Record<string, ReturnType<typeof setTimeout> | undefined>
  >;
  turnStartedAtBySessionRef: MutableRefObject<Record<string, number>>;
  turnUserAnchorAtBySessionRef: MutableRefObject<Record<string, number>>;
  previousAssistantCompletedAtBySessionRef: MutableRefObject<Record<string, number>>;
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

const createAssistantTurnTimingFieldBridge = <K extends keyof AssistantTurnTimingState>(
  stateRef: MutableRefObject<OrchestratorMutableState>,
  field: K,
): MutableRefObject<Record<string, NonNullable<AssistantTurnTimingState[K]>>> =>
  ({
    get current() {
      const values: Record<string, NonNullable<AssistantTurnTimingState[K]>> = {};
      for (const [sessionId, timing] of Object.entries(
        stateRef.current.assistantTurnTimingBySession,
      )) {
        const value = timing[field];
        if (value !== undefined) {
          values[sessionId] = value as NonNullable<AssistantTurnTimingState[K]>;
        }
      }
      return values;
    },
    set current(value) {
      const nextTimingBySession: Record<string, AssistantTurnTimingState> = {};
      for (const [sessionId, timing] of Object.entries(
        stateRef.current.assistantTurnTimingBySession,
      )) {
        nextTimingBySession[sessionId] = { ...timing };
      }
      for (const timing of Object.values(nextTimingBySession)) {
        delete timing[field];
      }
      for (const [sessionId, fieldValue] of Object.entries(value)) {
        nextTimingBySession[sessionId] = {
          ...(nextTimingBySession[sessionId] ?? {}),
          [field]: fieldValue,
        };
      }
      stateRef.current.assistantTurnTimingBySession = nextTimingBySession;
    },
  }) as MutableRefObject<Record<string, NonNullable<AssistantTurnTimingState[K]>>>;

const clearUnsubscribers = (unsubscribers: Map<string, () => void>): void => {
  const unsubscribeCallbacks = [...unsubscribers.values()];
  for (const unsubscribe of unsubscribeCallbacks) {
    unsubscribe();
  }
  unsubscribers.clear();
};

export const useOrchestratorSessionState = ({
  activeWorkspace,
  tasks,
}: UseOrchestratorSessionStateArgs): UseOrchestratorSessionStateResult => {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const sessionStore = useMemo(() => createAgentSessionsStore(), []);
  const mutableStateRef = useRef<OrchestratorMutableState>({
    sessionsById: {},
    tasks,
    activeWorkspace,
    currentWorkspaceRepoPath: workspaceRepoPath,
    repoEpoch: 0,
    inFlightStartsByWorkspaceTask: new Map<string, Promise<string>>(),
    unsubscribersBySession: new Map<string, () => void>(),
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
      activeWorkspaceRef: createMutableBridge(mutableStateRef, "activeWorkspace"),
      currentWorkspaceRepoPathRef: createMutableBridge(mutableStateRef, "currentWorkspaceRepoPath"),
      repoEpochRef: createMutableBridge(mutableStateRef, "repoEpoch"),
      inFlightStartsByWorkspaceTaskRef: createMutableBridge(
        mutableStateRef,
        "inFlightStartsByWorkspaceTask",
      ),
      unsubscribersRef: createMutableBridge(mutableStateRef, "unsubscribersBySession"),
      draftRawBySessionRef: createMutableBridge(mutableStateRef, "draftRawBySession"),
      draftSourceBySessionRef: createMutableBridge(mutableStateRef, "draftSourceBySession"),
      draftMessageIdBySessionRef: createMutableBridge(mutableStateRef, "draftMessageIdBySession"),
      draftFlushTimeoutBySessionRef: createMutableBridge(
        mutableStateRef,
        "draftFlushTimeoutBySession",
      ),
      turnStartedAtBySessionRef: createAssistantTurnTimingFieldBridge(
        mutableStateRef,
        "activityStartedAtMs",
      ),
      turnUserAnchorAtBySessionRef: createAssistantTurnTimingFieldBridge(
        mutableStateRef,
        "userAnchorAtMs",
      ),
      previousAssistantCompletedAtBySessionRef: createAssistantTurnTimingFieldBridge(
        mutableStateRef,
        "previousAssistantCompletedAtMs",
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
    mutableStateRef.current.activeWorkspace = activeWorkspace;
    mutableStateRef.current.tasks = tasks;
  }, [activeWorkspace, tasks]);

  useEffect(() => {
    if (mutableStateRef.current.currentWorkspaceRepoPath === workspaceRepoPath) {
      return;
    }
    mutableStateRef.current.repoEpoch += 1;
    mutableStateRef.current.currentWorkspaceRepoPath = workspaceRepoPath;

    clearUnsubscribers(mutableStateRef.current.unsubscribersBySession);
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
    commitSessions({});
  }, [workspaceRepoPath, commitSessions]);

  useEffect(() => {
    return () => {
      clearUnsubscribers(mutableStateRef.current.unsubscribersBySession);
      for (const timeoutId of Object.values(mutableStateRef.current.draftFlushTimeoutBySession)) {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
      mutableStateRef.current.inFlightStartsByWorkspaceTask.clear();
    };
  }, []);

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

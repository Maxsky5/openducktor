import type { RunSummary, TaskCard } from "@openducktor/contracts";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { DraftChannelValueMap, DraftSource } from "../events/session-event-types";

type SessionStateById = Record<string, AgentSessionState>;
type SessionStateUpdater = SessionStateById | ((current: SessionStateById) => SessionStateById);

type OrchestratorMutableState = {
  sessionsById: SessionStateById;
  tasks: TaskCard[];
  runs: RunSummary[];
  previousRepo: string | null;
  repoEpoch: number;
  inFlightStartsByRepoTask: Map<string, Promise<string>>;
  unsubscribersBySession: Map<string, () => void>;
  draftRawBySession: Record<string, DraftChannelValueMap<string>>;
  draftSourceBySession: Record<string, DraftChannelValueMap<DraftSource>>;
  draftMessageIdBySession: Record<string, DraftChannelValueMap<string>>;
  draftFlushTimeoutBySession: Record<string, ReturnType<typeof setTimeout> | undefined>;
  turnStartedAtBySession: Record<string, number>;
  turnModelBySession: Record<string, AgentSessionState["selectedModel"]>;
};

type OrchestratorRefBridges = {
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  taskRef: MutableRefObject<TaskCard[]>;
  runsRef: MutableRefObject<RunSummary[]>;
  previousRepoRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  inFlightStartsByRepoTaskRef: MutableRefObject<Map<string, Promise<string>>>;
  unsubscribersRef: MutableRefObject<Map<string, () => void>>;
  draftRawBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<string>>>;
  draftSourceBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<DraftSource>>>;
  draftMessageIdBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<string>>>;
  draftFlushTimeoutBySessionRef: MutableRefObject<
    Record<string, ReturnType<typeof setTimeout> | undefined>
  >;
  turnStartedAtBySessionRef: MutableRefObject<Record<string, number>>;
  turnModelBySessionRef: MutableRefObject<Record<string, AgentSessionState["selectedModel"]>>;
};

type UseOrchestratorSessionStateArgs = {
  activeRepo: string | null;
  tasks: TaskCard[];
  runs: RunSummary[];
};

type UseOrchestratorSessionStateResult = {
  sessionsById: SessionStateById;
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

const clearUnsubscribers = (unsubscribers: Map<string, () => void>): void => {
  const unsubscribeCallbacks = [...unsubscribers.values()];
  for (const unsubscribe of unsubscribeCallbacks) {
    unsubscribe();
  }
  unsubscribers.clear();
};

export const useOrchestratorSessionState = ({
  activeRepo,
  tasks,
  runs,
}: UseOrchestratorSessionStateArgs): UseOrchestratorSessionStateResult => {
  const [sessionsById, setSessionsById] = useState<SessionStateById>({});
  const mutableStateRef = useRef<OrchestratorMutableState>({
    sessionsById: {},
    tasks,
    runs,
    previousRepo: null,
    repoEpoch: 0,
    inFlightStartsByRepoTask: new Map<string, Promise<string>>(),
    unsubscribersBySession: new Map<string, () => void>(),
    draftRawBySession: {},
    draftSourceBySession: {},
    draftMessageIdBySession: {},
    draftFlushTimeoutBySession: {},
    turnStartedAtBySession: {},
    turnModelBySession: {},
  });
  const refBridges = useMemo<OrchestratorRefBridges>(
    () => ({
      sessionsRef: createMutableBridge(mutableStateRef, "sessionsById"),
      taskRef: createMutableBridge(mutableStateRef, "tasks"),
      runsRef: createMutableBridge(mutableStateRef, "runs"),
      previousRepoRef: createMutableBridge(mutableStateRef, "previousRepo"),
      repoEpochRef: createMutableBridge(mutableStateRef, "repoEpoch"),
      inFlightStartsByRepoTaskRef: createMutableBridge(mutableStateRef, "inFlightStartsByRepoTask"),
      unsubscribersRef: createMutableBridge(mutableStateRef, "unsubscribersBySession"),
      draftRawBySessionRef: createMutableBridge(mutableStateRef, "draftRawBySession"),
      draftSourceBySessionRef: createMutableBridge(mutableStateRef, "draftSourceBySession"),
      draftMessageIdBySessionRef: createMutableBridge(mutableStateRef, "draftMessageIdBySession"),
      draftFlushTimeoutBySessionRef: createMutableBridge(
        mutableStateRef,
        "draftFlushTimeoutBySession",
      ),
      turnStartedAtBySessionRef: createMutableBridge(mutableStateRef, "turnStartedAtBySession"),
      turnModelBySessionRef: createMutableBridge(mutableStateRef, "turnModelBySession"),
    }),
    [],
  );

  const commitSessions = useCallback((updater: SessionStateUpdater): void => {
    const current = mutableStateRef.current.sessionsById;
    const next = typeof updater === "function" ? updater(current) : updater;
    mutableStateRef.current.sessionsById = next;
    setSessionsById(next);
  }, []);

  useEffect(() => {
    mutableStateRef.current.tasks = tasks;
    mutableStateRef.current.runs = runs;
  }, [runs, tasks]);

  useEffect(() => {
    if (mutableStateRef.current.previousRepo === activeRepo) {
      return;
    }
    mutableStateRef.current.repoEpoch += 1;
    mutableStateRef.current.previousRepo = activeRepo;

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
    mutableStateRef.current.turnStartedAtBySession = {};
    mutableStateRef.current.turnModelBySession = {};
    mutableStateRef.current.inFlightStartsByRepoTask.clear();
    commitSessions({});
  }, [activeRepo, commitSessions]);

  useEffect(() => {
    return () => {
      clearUnsubscribers(mutableStateRef.current.unsubscribersBySession);
      for (const timeoutId of Object.values(mutableStateRef.current.draftFlushTimeoutBySession)) {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
      mutableStateRef.current.inFlightStartsByRepoTask.clear();
    };
  }, []);

  return {
    sessionsById,
    refBridges,
    commitSessions,
  };
};

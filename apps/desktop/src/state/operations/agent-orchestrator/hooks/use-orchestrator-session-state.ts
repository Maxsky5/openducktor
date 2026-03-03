import type { RunSummary, TaskCard } from "@openducktor/contracts";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type SessionStateById = Record<string, AgentSessionState>;
export type SessionStateUpdater =
  | SessionStateById
  | ((current: SessionStateById) => SessionStateById);

export type OrchestratorMutableState = {
  sessionsById: SessionStateById;
  tasks: TaskCard[];
  runs: RunSummary[];
  previousRepo: string | null;
  repoEpoch: number;
  inFlightStartsByRepoTask: Map<string, Promise<string>>;
  unsubscribersBySession: Map<string, () => void>;
  draftRawBySession: Record<string, string>;
  draftSourceBySession: Record<string, "delta" | "part">;
  turnStartedAtBySession: Record<string, number>;
};

export type OrchestratorRefBridges = {
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  taskRef: MutableRefObject<TaskCard[]>;
  runsRef: MutableRefObject<RunSummary[]>;
  previousRepoRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  inFlightStartsByRepoTaskRef: MutableRefObject<Map<string, Promise<string>>>;
  unsubscribersRef: MutableRefObject<Map<string, () => void>>;
  draftRawBySessionRef: MutableRefObject<Record<string, string>>;
  draftSourceBySessionRef: MutableRefObject<Record<string, "delta" | "part">>;
  turnStartedAtBySessionRef: MutableRefObject<Record<string, number>>;
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
  for (const unsubscribe of unsubscribers.values()) {
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
    turnStartedAtBySession: {},
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
      turnStartedAtBySessionRef: createMutableBridge(mutableStateRef, "turnStartedAtBySession"),
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
    mutableStateRef.current.draftRawBySession = {};
    mutableStateRef.current.draftSourceBySession = {};
    mutableStateRef.current.turnStartedAtBySession = {};
    mutableStateRef.current.inFlightStartsByRepoTask.clear();
    commitSessions({});
  }, [activeRepo, commitSessions]);

  useEffect(() => {
    return () => {
      clearUnsubscribers(mutableStateRef.current.unsubscribersBySession);
      mutableStateRef.current.inFlightStartsByRepoTask.clear();
    };
  }, []);

  return {
    sessionsById,
    refBridges,
    commitSessions,
  };
};

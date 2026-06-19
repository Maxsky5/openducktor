import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import { readRepoRuntimeSessionSnapshots } from "./repo-runtime-session-snapshots";
import { buildRepoSessionReadModel } from "./repo-session-read-model";
import type { SessionRuntimeReadiness } from "./session-runtime-readiness";
import type { TaskSessionRecords } from "./task-session-records";

type CommitSessionCollection = AgentSessionsStore["commitSessionCollection"];
type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionRuntimeSnapshots">;
type ClearSessionObservationState = (sessions: readonly AgentSessionRef[]) => void;

export const loadRepoSessionReadModel = async ({
  repoPath,
  taskSessionRecords,
  adapter,
  commitSessionCollection,
  observeAgentSession,
  clearSessionObservationState,
  runtimeReadiness,
  isStaleRepoOperation,
}: {
  repoPath: string;
  taskSessionRecords: TaskSessionRecords;
  adapter: SessionLoaderAdapter;
  commitSessionCollection: CommitSessionCollection;
  observeAgentSession: ObserveAgentSession;
  clearSessionObservationState: ClearSessionObservationState;
  runtimeReadiness: SessionRuntimeReadiness;
  isStaleRepoOperation: () => boolean;
}): Promise<boolean> => {
  if (isStaleRepoOperation()) {
    return false;
  }
  if (runtimeReadiness.kind === "waiting_for_runtime") {
    return false;
  }
  if (runtimeReadiness.kind === "blocked") {
    throw new Error(runtimeReadiness.message);
  }

  const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
    repoPath,
    tasks: taskSessionRecords,
    listSessionRuntimeSnapshots: (input) => adapter.listSessionRuntimeSnapshots(input),
  });
  if (isStaleRepoOperation()) {
    return false;
  }

  const readModel = commitSessionCollection((currentSessionCollection) => {
    const readModel = buildRepoSessionReadModel({
      repoPath,
      tasks: taskSessionRecords,
      currentSessionCollection,
      runtimeSnapshots,
    });
    return {
      collection: readModel.sessionCollection,
      result: readModel,
    };
  });
  clearSessionObservationState(readModel.unlistedSessionRefs);

  if (isStaleRepoOperation()) {
    return false;
  }

  await Promise.all(
    readModel.liveSessionRefs.map(async (session) => {
      if (!isStaleRepoOperation()) {
        await observeAgentSession(session);
      }
    }),
  );
  return true;
};

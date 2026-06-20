import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import { readRepoRuntimeSessionSnapshots } from "./repo-runtime-session-snapshots";
import { buildRepoSessionReadModel } from "./repo-session-read-model";
import type { TaskSessionRecords } from "./task-session-records";

type CommitSessionCollection = AgentSessionsStore["commitSessionCollection"];
type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionRuntimeSnapshots">;
type ClearSessionObservationState = (sessions: readonly AgentSessionRef[]) => void;

export const loadRepoSessionReadModel = async ({
  repoPath,
  taskSessionRecords,
  snapshotRuntimeKinds,
  adapter,
  commitSessionCollection,
  observeAgentSession,
  clearSessionObservationState,
  isStaleRepoOperation,
}: {
  repoPath: string;
  taskSessionRecords: TaskSessionRecords;
  snapshotRuntimeKinds?: readonly RuntimeKind[];
  adapter: SessionLoaderAdapter;
  commitSessionCollection: CommitSessionCollection;
  observeAgentSession: ObserveAgentSession;
  clearSessionObservationState: ClearSessionObservationState;
  isStaleRepoOperation: () => boolean;
}): Promise<boolean> => {
  if (isStaleRepoOperation()) {
    return false;
  }

  const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
    repoPath,
    tasks: taskSessionRecords,
    ...(snapshotRuntimeKinds ? { runtimeKinds: snapshotRuntimeKinds } : {}),
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

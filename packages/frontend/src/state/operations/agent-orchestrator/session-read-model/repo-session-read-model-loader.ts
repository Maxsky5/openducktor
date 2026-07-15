import type { RuntimeKind } from "@openducktor/contracts";
import {
  type AgentEnginePort,
  type PolicyBoundSessionRef,
  type SessionRef,
  toAgentRuntimePolicyBinding,
} from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import { getAgentSession, replaceAgentSession } from "@/state/agent-session-collection";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { appendSessionMessage } from "../support/messages";
import { buildSessionErrorNoticeMessage } from "../support/session-notice-messages";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import type { ResolveSessionRuntimePolicySync } from "./adapters/session-runtime-policy-resolver";
import { readRepoRuntimeSessionSnapshots } from "./repo-runtime-session-snapshots";
import { buildRepoSessionReadModel } from "./repo-session-read-model";
import type { TaskSessionRecords } from "./task-session-records";

type CommitSessionCollection = AgentSessionsStore["commitSessionCollection"];
type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionRuntimeSnapshots">;
type ClearSessionObservationState = (sessions: readonly SessionRef[]) => void;
type LoadSessionRuntimePolicyResolver = (
  runtimeKinds: readonly RuntimeKind[],
) => Promise<ResolveSessionRuntimePolicySync>;
type SessionObserverFailure = {
  session: PolicyBoundSessionRef;
  message: string;
};

const observeLiveSessions = async ({
  sessions,
  observeAgentSession,
  isStaleRepoOperation,
}: {
  sessions: readonly PolicyBoundSessionRef[];
  observeAgentSession: ObserveAgentSession;
  isStaleRepoOperation: () => boolean;
}): Promise<SessionObserverFailure[]> => {
  const results = await Promise.all(
    sessions.map(async (session): Promise<SessionObserverFailure | null> => {
      if (isStaleRepoOperation()) {
        return null;
      }

      try {
        await observeAgentSession(session);
        return null;
      } catch (error) {
        return {
          session,
          message: errorMessage(error),
        };
      }
    }),
  );

  return results.filter((result): result is SessionObserverFailure => result !== null);
};

const markSessionObserverFailures = ({
  failures,
  commitSessionCollection,
}: {
  failures: readonly SessionObserverFailure[];
  commitSessionCollection: CommitSessionCollection;
}): void => {
  if (failures.length === 0) {
    return;
  }

  const timestamp = new Date().toISOString();
  commitSessionCollection((currentSessionCollection) => {
    let nextSessionCollection = currentSessionCollection;
    for (const failure of failures) {
      const session = getAgentSession(nextSessionCollection, failure.session);
      if (!session) {
        continue;
      }
      nextSessionCollection = replaceAgentSession(nextSessionCollection, {
        ...session,
        pendingUserMessageStartedAt: undefined,
        runtimeStatusMessage: null,
        status: "error",
        pendingApprovals: [],
        pendingQuestions: [],
        messages: appendSessionMessage(
          { externalSessionId: session.externalSessionId, messages: session.messages },
          buildSessionErrorNoticeMessage(
            timestamp,
            `Failed to observe live session: ${failure.message}`,
          ),
        ),
      });
    }

    return {
      collection: nextSessionCollection,
      result: undefined,
    };
  });
};

export const loadRepoSessionReadModel = async ({
  repoPath,
  taskSessionRecords,
  snapshotRuntimeKinds,
  adapter,
  commitSessionCollection,
  observeAgentSession,
  clearSessionObservationState,
  loadLiveSessionHistory,
  loadSessionRuntimePolicyResolver,
  isStaleRepoOperation,
}: {
  repoPath: string;
  taskSessionRecords: TaskSessionRecords;
  snapshotRuntimeKinds?: readonly RuntimeKind[];
  adapter: SessionLoaderAdapter;
  commitSessionCollection: CommitSessionCollection;
  observeAgentSession: ObserveAgentSession;
  clearSessionObservationState: ClearSessionObservationState;
  loadLiveSessionHistory: (session: PolicyBoundSessionRef) => Promise<unknown>;
  loadSessionRuntimePolicyResolver: LoadSessionRuntimePolicyResolver;
  isStaleRepoOperation: () => boolean;
}): Promise<boolean> => {
  if (isStaleRepoOperation()) {
    return false;
  }

  const runtimeSnapshotBaseline = commitSessionCollection((currentSessionCollection) => ({
    collection: currentSessionCollection,
    result: currentSessionCollection,
  }));
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
      runtimeSnapshotBaseline,
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

  const runtimeKinds = Array.from(
    new Set(readModel.liveSessionRefs.map((session) => session.runtimeKind)),
  );
  const resolveSessionRuntimePolicy = await loadSessionRuntimePolicyResolver(runtimeKinds);
  if (isStaleRepoOperation()) {
    return false;
  }
  const liveSessionRefs: PolicyBoundSessionRef[] = readModel.liveSessionRefs.map((session) => {
    const runtimePolicy = resolveSessionRuntimePolicy({
      runtimeKind: session.runtimeKind,
      sessionScope: session.sessionScope ?? null,
    });
    return {
      ...session,
      ...toAgentRuntimePolicyBinding({ runtimeKind: session.runtimeKind, runtimePolicy }),
    };
  });

  const observerFailures = await observeLiveSessions({
    sessions: liveSessionRefs,
    observeAgentSession,
    isStaleRepoOperation,
  });
  if (isStaleRepoOperation()) {
    return false;
  }
  markSessionObserverFailures({
    failures: observerFailures,
    commitSessionCollection,
  });
  if (isStaleRepoOperation()) {
    return false;
  }

  await Promise.all(
    liveSessionRefs.map(async (session) => {
      if (isStaleRepoOperation()) {
        return;
      }

      await loadLiveSessionHistory(session);
    }),
  );
  if (isStaleRepoOperation()) {
    return false;
  }

  return true;
};

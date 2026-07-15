import type { RuntimeKind, SettingsSnapshot } from "@openducktor/contracts";
import type { AgentEnginePort, PolicyBoundSessionRef, SessionRef } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import { getAgentSession, replaceAgentSession } from "@/state/agent-session-collection";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { appendSessionMessage } from "../support/messages";
import { buildSessionErrorNoticeMessage } from "../support/session-notice-messages";
import { resolveAgentSessionRuntimePolicyFromSnapshot } from "../support/session-runtime-policy";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import { readRepoRuntimeSessionSnapshots } from "./repo-runtime-session-snapshots";
import { buildRepoSessionReadModel } from "./repo-session-read-model";
import type { TaskSessionRecords } from "./task-session-records";

type CommitSessionCollection = AgentSessionsStore["commitSessionCollection"];
type SessionLoaderAdapter = Pick<AgentEnginePort, "listSessionRuntimeSnapshots">;
type ClearSessionObservationState = (sessions: readonly SessionRef[]) => void;
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
  loadSettingsSnapshot,
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
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
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
  const requiresCodexRuntimePolicy =
    Array.from(runtimeSnapshots.values()).some(
      (snapshot) => snapshot.ref.runtimeKind === "codex",
    ) || snapshotRuntimeKinds?.includes("codex") === true;
  const settingsSnapshot = requiresCodexRuntimePolicy ? await loadSettingsSnapshot() : null;
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
      resolveSessionRuntimePolicy: ({ runtimeKind, sessionScope }) => {
        if (runtimeKind === "opencode") {
          return { kind: "opencode" };
        }
        if (!settingsSnapshot) {
          throw new Error(
            `Settings snapshot is required to resolve ${runtimeKind} runtime policy.`,
          );
        }
        return resolveAgentSessionRuntimePolicyFromSnapshot({
          runtimeKind,
          snapshot: settingsSnapshot,
          ...(sessionScope !== undefined ? { sessionScope } : {}),
        });
      },
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

  const observerFailures = await observeLiveSessions({
    sessions: readModel.liveSessionRefs,
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
    readModel.liveSessionRefs.map(async (session) => {
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

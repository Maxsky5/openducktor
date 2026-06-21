import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentEnginePort, AgentRole } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { getAgentSession, replaceAgentSession } from "@/state/agent-session-collection";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { loadAgentSessionListFromQuery } from "@/state/queries/agent-sessions";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createRepoStaleGuard } from "../support/core";
import { toPersistedSessionIdentity, toPersistedSessionView } from "../support/persistence";
import { type ObserveAgentSession, toRuntimeSessionRef } from "../support/session-runtime-ref";
import {
  applyRuntimeSnapshotToSession,
  shouldObserveAgentSessionRuntimeSnapshot,
} from "./session-runtime-snapshot";

type CommitSessionCollection = AgentSessionsStore["commitSessionCollection"];
type SourceSessionLoaderAdapter = Pick<AgentEnginePort, "readSessionRuntimeSnapshot">;

type CreateSourceSessionLoaderArgs = {
  workspaceRepoPath: string | null;
  adapter: SourceSessionLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  commitSessionCollection: CommitSessionCollection;
  observeAgentSession: ObserveAgentSession;
  queryClient: QueryClient;
};

export type LoadSourceSessionInput = {
  taskId: string;
  role: AgentRole;
  sourceSession: AgentSessionIdentity;
};

export type LoadSourceSession = (
  input: LoadSourceSessionInput,
) => Promise<AgentSessionState | null>;

const findSourceSessionRecord = (
  records: readonly AgentSessionRecord[],
  input: LoadSourceSessionInput,
): AgentSessionRecord | null =>
  records.find(
    (record) =>
      record.role === input.role &&
      matchesAgentSessionIdentity(toPersistedSessionIdentity(record), input.sourceSession),
  ) ?? null;

export const createLoadSourceSession = ({
  workspaceRepoPath,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  commitSessionCollection,
  observeAgentSession,
  queryClient,
}: CreateSourceSessionLoaderArgs): LoadSourceSession => {
  return async ({ taskId, role, sourceSession }): Promise<AgentSessionState | null> => {
    if (!workspaceRepoPath || taskId.trim().length === 0) {
      return null;
    }

    const repoPath = workspaceRepoPath;
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    });
    if (isStaleRepoOperation()) {
      return null;
    }

    const records = await loadAgentSessionListFromQuery(queryClient, repoPath, taskId, {
      forceFresh: true,
    });
    if (isStaleRepoOperation()) {
      return null;
    }

    const record = findSourceSessionRecord(records, { taskId, role, sourceSession });
    if (!record) {
      return null;
    }

    const ref = toRuntimeSessionRef(repoPath, toPersistedSessionIdentity(record));
    const runtimeSnapshot = await adapter.readSessionRuntimeSnapshot(ref);
    if (isStaleRepoOperation()) {
      return null;
    }

    const loadedSession = commitSessionCollection((currentSessionCollection) => {
      const current = getAgentSession(currentSessionCollection, sourceSession) ?? undefined;
      const sourceView = toPersistedSessionView({ taskId, record, current });
      const session = applyRuntimeSnapshotToSession(sourceView, runtimeSnapshot);
      return {
        collection: replaceAgentSession(currentSessionCollection, session),
        result: session,
      };
    });

    if (shouldObserveAgentSessionRuntimeSnapshot(runtimeSnapshot) && !isStaleRepoOperation()) {
      await observeAgentSession(toRuntimeSessionRef(repoPath, loadedSession));
    }

    return isStaleRepoOperation() ? null : loadedSession;
  };
};

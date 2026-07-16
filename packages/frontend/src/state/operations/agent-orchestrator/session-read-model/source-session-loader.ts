import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { loadAgentSessionListFromQuery } from "@/state/queries/agent-sessions";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createRepoStaleGuard } from "../support/core";
import { toPersistedSessionIdentity } from "../support/persistence";

type ReadSessionSnapshot = AgentSessionsStore["getSessionSnapshot"];

type CreateSourceSessionLoaderArgs = {
  workspaceRepoPath: string | null;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  readSessionSnapshot: ReadSessionSnapshot;
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
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  readSessionSnapshot,
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

    const identity = toPersistedSessionIdentity(record);
    const loadedSession = readSessionSnapshot(identity);
    return isStaleRepoOperation() ? null : loadedSession;
  };
};

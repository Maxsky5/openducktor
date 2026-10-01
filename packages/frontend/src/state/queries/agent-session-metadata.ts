import type { AgentSessionMetadata, RepoRuntimeRef } from "@openducktor/contracts";
import type { LoadAgentSessionMetadataInput } from "@openducktor/core";
import { type Query, type QueryClient, queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { host } from "../operations/host";

export const agentSessionMetadataQueryKeys = {
  all: ["agent-session-metadata"] as const,
  runtime: ({ repoPath, runtimeKind }: RepoRuntimeRef) =>
    [
      ...agentSessionMetadataQueryKeys.all,
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
    ] as const,
  session: (input: LoadAgentSessionMetadataInput) =>
    [
      ...agentSessionMetadataQueryKeys.runtime(input),
      normalizeWorkingDirectory(input.workingDirectory),
      input.externalSessionId,
      input.sessionScope.taskId,
      input.sessionScope.role,
    ] as const,
};

/**
 * Native activity time of a saved task session.
 *
 * Live observation supplies newer times, so a successful read stays fresh. A failed read
 * retries when its runtime becomes ready or when a new observer mounts.
 */
export const agentSessionMetadataQueryOptions = (input: LoadAgentSessionMetadataInput) =>
  queryOptions<AgentSessionMetadata, Error>({
    queryKey: agentSessionMetadataQueryKeys.session(input),
    queryFn: () => host.agentRuntimeLoadSessionMetadata(input),
    staleTime: Number.POSITIVE_INFINITY,
  });

/**
 * A runtime that becomes ready can answer the metadata reads that failed while it was away.
 *
 * A read in flight can still fail from that time. A refetch joins a first read in flight
 * instead of starting again, so the read is cancelled first.
 */
export const retryUnansweredAgentSessionMetadata = async (
  queryClient: QueryClient,
  scope: RepoRuntimeRef,
): Promise<void> => {
  const queryKey = agentSessionMetadataQueryKeys.runtime(scope);
  const unanswered = new Set(
    queryClient
      .getQueryCache()
      .findAll({ queryKey })
      .filter((query) => query.state.status === "error" || query.state.fetchStatus === "fetching"),
  );
  if (unanswered.size === 0) return;
  const predicate = (query: Query): boolean => unanswered.has(query);
  await queryClient.cancelQueries({ queryKey, predicate });
  await queryClient.invalidateQueries({ queryKey, predicate });
};

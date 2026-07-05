import type { AgentSessionHistoryMessage, LoadAgentSessionHistoryInput } from "@openducktor/core";
import { type QueryKey, queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";

export const SESSION_HISTORY_STALE_TIME_MS = 0;

export const agentSessionHistoryQueryKeys = {
  all: ["agent-session-history"] as const,
  history: ({
    repoPath,
    runtimeKind,
    workingDirectory,
    externalSessionId,
  }: LoadAgentSessionHistoryInput) =>
    [
      ...agentSessionHistoryQueryKeys.all,
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
      externalSessionId,
    ] as const,
};

export const sessionHistoryQueryOptions = (
  session: LoadAgentSessionHistoryInput,
  readSessionHistory: (
    session: LoadAgentSessionHistoryInput,
  ) => Promise<AgentSessionHistoryMessage[]>,
) =>
  queryOptions<AgentSessionHistoryMessage[], Error, AgentSessionHistoryMessage[], QueryKey>({
    queryKey: agentSessionHistoryQueryKeys.history(session),
    queryFn: (): Promise<AgentSessionHistoryMessage[]> => readSessionHistory(session),
    staleTime: SESSION_HISTORY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });

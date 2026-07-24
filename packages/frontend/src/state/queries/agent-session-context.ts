import type {
  AgentSessionContextUsage,
  AgentSessionLiveLoadContextInput,
} from "@openducktor/contracts";
import { type QueryClient, type QueryKey, queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";

export const SESSION_CONTEXT_STALE_TIME_MS = 0;

export const agentSessionContextQueryKeys = {
  all: ["agent-session-context"] as const,
  usage: ({
    repoPath,
    runtimeKind,
    workingDirectory,
    externalSessionId,
    sessionScope,
  }: AgentSessionLiveLoadContextInput) =>
    [
      ...agentSessionContextQueryKeys.all,
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
      externalSessionId,
      sessionScope?.taskId ?? null,
      sessionScope?.role ?? null,
    ] as const,
};

type LoadAgentSessionContext = (
  input: AgentSessionLiveLoadContextInput,
) => Promise<AgentSessionContextUsage | null>;

export const sessionContextQueryOptions = (
  input: AgentSessionLiveLoadContextInput,
  loadContext: LoadAgentSessionContext,
) =>
  queryOptions<AgentSessionContextUsage | null, Error, AgentSessionContextUsage | null, QueryKey>({
    queryKey: agentSessionContextQueryKeys.usage(input),
    queryFn: () => loadContext(input),
    staleTime: SESSION_CONTEXT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });

export const loadAgentSessionContextFromQuery = (
  queryClient: QueryClient,
  input: AgentSessionLiveLoadContextInput,
  loadContext: LoadAgentSessionContext,
): Promise<AgentSessionContextUsage | null> =>
  queryClient.fetchQuery(sessionContextQueryOptions(input, loadContext));

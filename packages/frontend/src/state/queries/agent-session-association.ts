import type {
  AgentSessionLiveRef,
  AgentSessionRecord,
  AgentSessionWorkflowScope,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { agentSessionQueryKeys } from "./agent-sessions";

export const readCachedAgentSessionAssociation = (
  queryClient: QueryClient,
  ref: AgentSessionLiveRef,
): AgentSessionWorkflowScope | null => {
  const lists = queryClient.getQueriesData<AgentSessionRecord[]>({
    queryKey: [...agentSessionQueryKeys.all, "list", ref.repoPath],
  });
  for (const [key, records] of lists) {
    const record = records?.find((entry) => matchesAgentSessionIdentity(entry, ref));
    if (record)
      return { kind: "workflow", taskId: z.string().min(1).parse(key[3]), role: record.role };
  }
  return null;
};

import type {
  AgentSessionLiveRef,
  AgentSessionRecord,
  AgentSessionWorkflowScope,
  AgentSessionScope,
  WorkspaceSession,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { matchesAgentSessionIdentity } from "../lib/agent-session-identity";
import { agentSessionQueryKeys } from "./agent-sessions";
import { queryWorkspaceScope } from "./workspace-scope";
import { workspaceSessionQueryKeys } from "./workspace-sessions";

export const findWorkspaceSessionByIdentity = (
  records: readonly WorkspaceSession[],
  ref: Pick<AgentSessionLiveRef, "externalSessionId" | "runtimeKind" | "workingDirectory">,
): WorkspaceSession | undefined =>
  records.find(
    (record) =>
      record.externalSessionId !== null &&
      matchesAgentSessionIdentity(
        {
          ...record,
          externalSessionId: record.externalSessionId,
          workingDirectory: record.executionTarget.workingDirectory,
        },
        ref,
      ),
  );

export function readCachedAgentSessionAssociation(
  queryClient: QueryClient,
  ref: AgentSessionLiveRef,
): AgentSessionWorkflowScope | null;
export function readCachedAgentSessionAssociation(
  queryClient: QueryClient,
  ref: AgentSessionLiveRef,
  workspaceId: string | null,
): AgentSessionScope | null;

export function readCachedAgentSessionAssociation(
  queryClient: QueryClient,
  ref: AgentSessionLiveRef,
  workspaceId?: string | null,
): AgentSessionScope | null {
  const lists = queryClient.getQueriesData<AgentSessionRecord[]>({
    queryKey: [...agentSessionQueryKeys.all, "list"],
    predicate: (query) => {
      const scope = queryWorkspaceScope(query);
      return (
        scope?.repoPath === ref.repoPath && (!workspaceId || scope.workspaceId === workspaceId)
      );
    },
  });
  for (const [key, records] of lists) {
    const record = records?.find((entry) => matchesAgentSessionIdentity(entry, ref));
    const scope = queryWorkspaceScope({ queryKey: key });
    if (record && scope)
      return {
        kind: "workflow",
        workspaceId: scope.workspaceId,
        taskId: z.string().min(1).parse(key[3]),
        role: record.role,
      };
  }
  if (workspaceId) {
    const records = queryClient.getQueryData<WorkspaceSession[]>(
      workspaceSessionQueryKeys.list(workspaceId, false),
    );
    if (records && findWorkspaceSessionByIdentity(records, ref))
      return { kind: "repository", workspaceId };
  }
  return null;
}

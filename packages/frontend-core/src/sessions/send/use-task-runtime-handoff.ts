import type {
  AgentChatRef,
  AgentSessionRecord,
  SessionOperationObservation,
  WorkspaceRef,
} from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { skippedQueryOptions } from "../../queries/skipped-query";
import { agentSessionListQueryOptions, agentSessionQueryKeys } from "../../queries/agent-sessions";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import { handoffLinksWithAcceptance, useHandoffObservation } from "./runtime-handoff";
import {
  matchesAgentSessionIdentity,
  toAgentSessionIdentity,
} from "../../lib/agent-session-identity";

type TaskHandoffScope = WorkspaceRef & { taskId: string; role: string };

export const useTaskRuntimeHandoff = (
  scope: TaskHandoffScope | null,
  identity: AgentSessionIdentity | null,
) => {
  const records = useQuery(
    scope
      ? agentSessionListQueryOptions(scope, scope.taskId)
      : skippedQueryOptions<
          import("@openducktor/contracts").AgentSessionRecord[],
          ReturnType<typeof agentSessionQueryKeys.list>
        >({
          queryKey: agentSessionQueryKeys.list({ repoPath: "", workspaceId: "" }, ""),
          staleTime: Number.POSITIVE_INFINITY,
        }),
  );
  const observed = useHandoffObservation(identity, scope?.repoPath ?? null);
  return scope && identity
    ? taskHandoffForSession(scope, identity, records.data ?? [], observed)
    : null;
};

export function readTaskHandoff(
  observed: SessionOperationObservation | undefined,
  scope: {
    workspaceId: string | null;
    repoPath: string | null;
    taskId: string | undefined;
    role: string | null;
  },
) {
  const handoff = observed?.handoff;
  if (!handoff || handoff.chat.kind !== "task_session") return null;
  const { chat } = handoff;
  return chat.workspaceId === scope.workspaceId &&
    chat.repoPath === scope.repoPath &&
    chat.taskId === scope.taskId &&
    chat.role === scope.role
    ? { chat, link: handoff.acceptedLink, committed: handoff.committed }
    : null;
}

function taskHandoffForSession(
  scope: TaskHandoffScope,
  identity: AgentSessionIdentity,
  records: readonly AgentSessionRecord[],
  observed: SessionOperationObservation | undefined,
) {
  const accepted = readTaskHandoff(observed, scope);
  const link = accepted?.link;
  const anchor = link ? accepted.chat.first : identity;
  const record =
    records.find(
      (record) =>
        record.role === scope.role &&
        record.handoff?.links.some(({ to }) => matchesAgentSessionIdentity(to, identity)),
    ) ??
    records.find(
      (record) => record.role === scope.role && matchesAgentSessionIdentity(record, anchor),
    );
  const first = record ? toAgentSessionIdentity(record) : accepted?.chat.first;
  if (!first) return null;
  const chat: Extract<AgentChatRef, { kind: "task_session" }> = {
    ...scope,
    kind: "task_session",
    first,
  };
  const savedLinks = record?.handoff?.links;
  const links = handoffLinksWithAcceptance(savedLinks, link) ?? [];
  return {
    chat,
    links,
    active: links.at(-1)?.to ?? first,
    savedActive: savedLinks?.at(-1)?.to ?? link?.from ?? first,
  };
}

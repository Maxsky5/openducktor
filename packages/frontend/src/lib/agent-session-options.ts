import type { AgentRole } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type AgentSessionOptionSummary = Pick<
  AgentSessionState,
  "externalSessionId" | "role" | "startedAt" | "status"
>;

export const compareAgentSessionRecency = (
  a: AgentSessionOptionSummary,
  b: AgentSessionOptionSummary,
): number => {
  if (a.startedAt !== b.startedAt) {
    return a.startedAt > b.startedAt ? -1 : 1;
  }
  if (a.externalSessionId === b.externalSessionId) {
    return 0;
  }
  return a.externalSessionId > b.externalSessionId ? -1 : 1;
};

export const buildRoleSessionSequenceById = (
  sessions: AgentSessionOptionSummary[],
): Map<string, number> => {
  return new Map(
    [...sessions]
      .sort((a, b) => {
        if (a.startedAt !== b.startedAt) {
          return a.startedAt < b.startedAt ? -1 : 1;
        }
        if (a.externalSessionId === b.externalSessionId) {
          return 0;
        }
        return a.externalSessionId < b.externalSessionId ? -1 : 1;
      })
      .map((session, index) => [session.externalSessionId, index + 1]),
  );
};

export const formatAgentSessionOptionLabel = (params: {
  session: AgentSessionOptionSummary;
  sessionNumber: number;
  roleLabelByRole: Record<AgentRole, string>;
}): string => {
  if (params.session.role === null) {
    throw new Error(`Session ${params.session.externalSessionId} is not a workflow session.`);
  }
  const roleLabel = params.roleLabelByRole[params.session.role];
  return `${roleLabel} #${params.sessionNumber}`;
};

export const formatAgentSessionOptionDescription = (session: AgentSessionOptionSummary): string => {
  const startedAt = new Date(session.startedAt);
  const startedAtLabel = Number.isNaN(startedAt.getTime())
    ? session.startedAt
    : startedAt.toLocaleString();
  return `${startedAtLabel} · ${session.status} · ${session.externalSessionId.slice(0, 8)}`;
};

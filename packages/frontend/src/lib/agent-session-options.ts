import type { AgentRole } from "@openducktor/core";
import { formatAgentSessionActivityStateLabel } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";

export type AgentSessionRecencySummary = AgentSessionIdentity &
  Pick<AgentSessionState, "startedAt">;

export type AgentSessionOptionSummary = AgentSessionRecencySummary &
  Pick<AgentSessionState, "role"> & {
    activityState: AgentSessionActivityState;
  };

export const compareAgentSessionRecency = (
  a: AgentSessionRecencySummary,
  b: AgentSessionRecencySummary,
): number => {
  if (a.startedAt !== b.startedAt) {
    return a.startedAt > b.startedAt ? -1 : 1;
  }
  const leftIdentityKey = agentSessionIdentityKey(a);
  const rightIdentityKey = agentSessionIdentityKey(b);
  if (leftIdentityKey === rightIdentityKey) {
    return 0;
  }
  return leftIdentityKey > rightIdentityKey ? -1 : 1;
};

export const buildRoleSessionSequenceByIdentity = (
  sessions: AgentSessionOptionSummary[],
): Map<string, number> => {
  return new Map(
    sessions
      .toSorted((a, b) => {
        if (a.startedAt !== b.startedAt) {
          return a.startedAt < b.startedAt ? -1 : 1;
        }
        const leftIdentityKey = agentSessionIdentityKey(a);
        const rightIdentityKey = agentSessionIdentityKey(b);
        if (leftIdentityKey === rightIdentityKey) {
          return 0;
        }
        return leftIdentityKey < rightIdentityKey ? -1 : 1;
      })
      .map((session, index) => [agentSessionIdentityKey(session), index + 1]),
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
  return `${startedAtLabel} · ${formatAgentSessionActivityStateLabel(
    session.activityState,
  )} · ${session.externalSessionId.slice(0, 8)}`;
};

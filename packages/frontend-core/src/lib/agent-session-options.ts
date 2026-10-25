import type { AgentRole } from "@openducktor/core";
import { formatAgentSessionActivityStateLabel } from "./agent-session-activity-state";
import { agentSessionIdentityKey } from "./agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "../types/agent-orchestrator";
import type { AgentSessionActivityState } from "../types/agent-session-activity";

export type AgentSessionRecencySummary = AgentSessionIdentity &
  Pick<AgentSessionState, "startedAt">;

export type AgentSessionOptionSummary = AgentSessionRecencySummary & { role: AgentRole } & {
  activityState: AgentSessionActivityState;
  statusUnavailableReason?: AgentSessionState["statusUnavailableReason"];
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
  sessions: readonly AgentSessionRecencySummary[],
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
  session: Pick<AgentSessionOptionSummary, "role">;
  sessionNumber: number;
  roleLabelByRole: Record<AgentRole, string>;
}): string => {
  const roleLabel = params.roleLabelByRole[params.session.role];
  return `${roleLabel} #${params.sessionNumber}`;
};

export const formatAgentSessionOptionDescription = (session: AgentSessionOptionSummary): string => {
  const startedAt = new Date(session.startedAt);
  const startedAtLabel = Number.isNaN(startedAt.getTime())
    ? session.startedAt
    : startedAt.toLocaleString();
  const activityLabel = formatAgentSessionActivityStateLabel(session.activityState);
  let statusLabel = activityLabel;
  if (session.statusUnavailableReason) {
    statusLabel = `status unavailable: ${session.statusUnavailableReason}`;
    if (session.activityState === "waiting_input" || session.activityState === "error")
      statusLabel = `${activityLabel} · ${statusLabel}`;
  }
  return `${startedAtLabel} · ${statusLabel} · ${session.externalSessionId.slice(0, 8)}`;
};

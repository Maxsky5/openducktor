import {
  formatAgentSessionActivityStateLabel,
  isAgentSessionActivityActive,
} from "./agent-session-activity-state";
import { agentSessionIdentityKey } from "./agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "../types/agent-orchestrator";
import type { AgentSessionActivityState } from "../types/agent-session-activity";
import type { WorkflowRoleId as AgentRole } from "@openducktor/workflows";

export type AgentSessionRecencySummary = AgentSessionIdentity &
  Pick<AgentSessionState, "startedAt">;

type TaskSessionOption = AgentSessionRecencySummary & { role: AgentRole };

export type AgentSessionOptionSummary = TaskSessionOption & {
  activityState: AgentSessionActivityState;
  statusUnavailableReason?: AgentSessionState["statusUnavailableReason"];
};

/** Prefer the latest active session, then the latest saved session. Ties keep the input order. */
export const resolveLatestTaskSession = (
  live: readonly AgentSessionOptionSummary[],
  saved: readonly TaskSessionOption[],
): TaskSessionOption | null => {
  let latestActive: TaskSessionOption | null = null;
  for (const session of live) {
    if (
      isAgentSessionActivityActive(session.activityState, session.statusUnavailableReason) &&
      (!latestActive || Date.parse(session.startedAt) > Date.parse(latestActive.startedAt))
    ) {
      latestActive = session;
    }
  }
  if (latestActive) return latestActive;

  let latestSaved: TaskSessionOption | null = null;
  for (const session of saved) {
    if (!latestSaved || Date.parse(session.startedAt) > Date.parse(latestSaved.startedAt)) {
      latestSaved = session;
    }
  }
  return latestSaved;
};

export const compareAgentSessionRecency = (
  a: AgentSessionRecencySummary,
  b: AgentSessionRecencySummary,
): number => {
  if (Date.parse(a.startedAt) !== Date.parse(b.startedAt)) {
    return Date.parse(a.startedAt) > Date.parse(b.startedAt) ? -1 : 1;
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
        if (Date.parse(a.startedAt) !== Date.parse(b.startedAt)) {
          return Date.parse(a.startedAt) < Date.parse(b.startedAt) ? -1 : 1;
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

import type { AgentRole, AgentScenario } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export const compareAgentSessionRecency = (a: AgentSessionState, b: AgentSessionState): number => {
  if (a.startedAt !== b.startedAt) {
    return a.startedAt > b.startedAt ? -1 : 1;
  }
  if (a.sessionId === b.sessionId) {
    return 0;
  }
  return a.sessionId > b.sessionId ? -1 : 1;
};

export const buildRoleSessionSequenceById = (
  sessions: AgentSessionState[],
): Map<string, number> => {
  return new Map(
    [...sessions]
      .sort((a, b) => {
        if (a.startedAt !== b.startedAt) {
          return a.startedAt < b.startedAt ? -1 : 1;
        }
        if (a.sessionId === b.sessionId) {
          return 0;
        }
        return a.sessionId < b.sessionId ? -1 : 1;
      })
      .map((session, index) => [session.sessionId, index + 1]),
  );
};

export const formatAgentSessionOptionLabel = (params: {
  session: AgentSessionState;
  sessionNumber: number;
  scenarioLabels: Record<AgentScenario, string>;
  roleLabelByRole: Record<AgentRole, string>;
}): string => {
  const scenarioLabel = params.scenarioLabels[params.session.scenario];
  const roleLabel = params.roleLabelByRole[params.session.role];
  const baseLabel = scenarioLabel === roleLabel ? roleLabel : `${scenarioLabel} · ${roleLabel}`;
  return `${baseLabel} #${params.sessionNumber}`;
};

export const formatAgentSessionOptionDescription = (session: AgentSessionState): string => {
  const startedAt = new Date(session.startedAt);
  const startedAtLabel = Number.isNaN(startedAt.getTime())
    ? session.startedAt
    : startedAt.toLocaleString();
  return `${startedAtLabel} · ${session.status} · ${session.sessionId.slice(0, 8)}`;
};

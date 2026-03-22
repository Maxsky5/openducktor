import type { AgentRole } from "@openducktor/core";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { SCENARIO_LABELS } from "./session-start-prompts";
import type { SessionStartReusableSessionOption } from "./session-start-types";

const compareSessionRecency = (a: AgentSessionState, b: AgentSessionState): number => {
  if (a.startedAt !== b.startedAt) {
    return a.startedAt > b.startedAt ? -1 : 1;
  }
  if (a.sessionId === b.sessionId) {
    return 0;
  }
  return a.sessionId > b.sessionId ? -1 : 1;
};

export const buildReusableSessionOptions = ({
  sessions,
  role,
}: {
  sessions: AgentSessionState[];
  role: AgentRole;
}): SessionStartReusableSessionOption[] => {
  const roleLabel = AGENT_ROLE_LABELS[role] ?? role.toUpperCase();

  return sessions
    .filter((session) => session.role === role)
    .sort(compareSessionRecency)
    .map((session, index) => ({
      value: session.sessionId,
      label: `${roleLabel} session ${session.sessionId.slice(0, 8)}`,
      description: `Started ${new Date(session.startedAt).toLocaleString()} · ${SCENARIO_LABELS[session.scenario]} · ${session.status}.`,
      ...(index === 0 ? { secondaryLabel: "Latest" } : {}),
    }));
};

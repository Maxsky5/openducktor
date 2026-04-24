import type { AgentRole } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import {
  buildRoleSessionSequenceById,
  compareAgentSessionRecency,
  formatAgentSessionOptionDescription,
  formatAgentSessionOptionLabel,
} from "@/lib/agent-session-options";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { AGENT_ROLE_LABELS } from "@/types";
import { SCENARIO_LABELS } from "./session-start-prompts";
import type { SessionStartExistingSessionOption } from "./session-start-types";

export const buildReusableSessionOptions = ({
  sessions,
  role,
}: {
  sessions: AgentSessionSummary[];
  role: AgentRole;
}): SessionStartExistingSessionOption[] => {
  const roleSessions = sessions.filter((session) => session.role === role);
  const roleSessionNumberById = buildRoleSessionSequenceById(roleSessions);

  return roleSessions.sort(compareAgentSessionRecency).map((session, index) => ({
    value: session.sessionId,
    label: formatAgentSessionOptionLabel({
      session,
      sessionNumber: roleSessionNumberById.get(session.sessionId) ?? index + 1,
      scenarioLabels: SCENARIO_LABELS,
      roleLabelByRole: AGENT_ROLE_LABELS,
    }),
    description: formatAgentSessionOptionDescription(session),
    selectedModel: session.selectedModel
      ? {
          ...session.selectedModel,
          runtimeKind:
            session.selectedModel.runtimeKind ?? session.runtimeKind ?? DEFAULT_RUNTIME_KIND,
        }
      : null,
    ...(index === 0 ? { secondaryLabel: "Latest" } : {}),
  }));
};

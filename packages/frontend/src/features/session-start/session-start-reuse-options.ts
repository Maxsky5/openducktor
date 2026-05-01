import type { AgentRole } from "@openducktor/core";
import {
  buildRoleSessionSequenceById,
  compareAgentSessionRecency,
  formatAgentSessionOptionDescription,
  formatAgentSessionOptionLabel,
} from "@/lib/agent-session-options";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { AGENT_ROLE_LABELS } from "@/types";
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

  return roleSessions.sort(compareAgentSessionRecency).map((session, index) => {
    const runtimeKind = session.selectedModel?.runtimeKind ?? session.runtimeKind ?? null;
    return {
      value: session.externalSessionId,
      label: formatAgentSessionOptionLabel({
        session,
        sessionNumber: roleSessionNumberById.get(session.externalSessionId) ?? index + 1,
        roleLabelByRole: AGENT_ROLE_LABELS,
      }),
      description: formatAgentSessionOptionDescription(session),
      selectedModel:
        session.selectedModel && runtimeKind
          ? {
              ...session.selectedModel,
              runtimeKind,
            }
          : null,
      ...(index === 0 ? { secondaryLabel: "Latest" } : {}),
    };
  });
};

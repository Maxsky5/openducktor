import type { AgentRole } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  buildRoleSessionSequenceByIdentity,
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
  const roleSessionNumberByIdentity = buildRoleSessionSequenceByIdentity(roleSessions);

  return roleSessions.sort(compareAgentSessionRecency).map((session, index) => {
    const runtimeKind = session.selectedModel?.runtimeKind ?? session.runtimeKind;
    return {
      value: agentSessionIdentityKey(session),
      sourceExternalSessionId: session.externalSessionId,
      runtimeKind: session.runtimeKind,
      label: formatAgentSessionOptionLabel({
        session,
        sessionNumber:
          roleSessionNumberByIdentity.get(agentSessionIdentityKey(session)) ?? index + 1,
        roleLabelByRole: AGENT_ROLE_LABELS,
      }),
      description: formatAgentSessionOptionDescription(session),
      selectedModel: session.selectedModel
        ? {
            ...session.selectedModel,
            runtimeKind,
          }
        : null,
      ...(index === 0 ? { secondaryLabel: "Latest" } : {}),
    };
  });
};

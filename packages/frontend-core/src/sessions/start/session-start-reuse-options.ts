import type { WorkflowRoleId as AgentRole } from "@openducktor/workflows";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "../../lib/agent-session-identity";
import {
  buildRoleSessionSequenceByIdentity,
  compareAgentSessionRecency,
  formatAgentSessionOptionDescription,
  formatAgentSessionOptionLabel,
} from "../../lib/agent-session-options";
import type { AgentSessionSummary } from "../agent-sessions-store";
import type { SessionStartExistingSessionOption } from "./session-start-types";

export const buildReusableSessionOptions = ({
  sessions,
  role,
  roleLabel,
}: {
  sessions: AgentSessionSummary[];
  role: AgentRole;
  roleLabel: string;
}): SessionStartExistingSessionOption[] => {
  const roleSessions = sessions.filter((session) => session.role === role);
  const roleSessionNumberByIdentity = buildRoleSessionSequenceByIdentity(roleSessions);

  return roleSessions.sort(compareAgentSessionRecency).map((session, index) => {
    const runtimeKind = session.selectedModel?.runtimeKind ?? session.runtimeKind;
    const option: SessionStartExistingSessionOption = {
      value: agentSessionIdentityKey(session),
      sourceSession: toAgentSessionIdentity(session),
      runtimeKind: session.runtimeKind,
      label: formatAgentSessionOptionLabel({
        session,
        sessionNumber:
          roleSessionNumberByIdentity.get(agentSessionIdentityKey(session)) ?? index + 1,
        roleLabelByRole: { [role]: roleLabel },
      }),
      description: formatAgentSessionOptionDescription(session),
      selectedModel: session.selectedModel
        ? {
            ...session.selectedModel,
            runtimeKind,
          }
        : null,
    };

    if (index === 0) {
      option.secondaryLabel = "Latest";
    }

    return option;
  });
};

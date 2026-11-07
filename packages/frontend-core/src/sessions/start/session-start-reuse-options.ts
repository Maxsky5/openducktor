import {
  taskPullRequestSessions,
  workflowRoleLabel,
  type WorkflowRoleId as AgentRole,
  type ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
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

/**
 * The sessions that the core pull request launch can continue or fork, latest first. They can
 * have several roles, so each option names the role of its session.
 */
export const buildPullRequestSessionOptions = ({
  task,
  sessions,
}: {
  task: TaskCard;
  sessions: AgentSessionSummary[];
}): SessionStartExistingSessionOption[] => {
  const candidates = taskPullRequestSessions(task, sessions).sort(compareAgentSessionRecency);
  const rank = new Map(
    candidates.map((session, index) => [agentSessionIdentityKey(session), index]),
  );
  const roles = [...new Set(candidates.map(({ role }) => role))];
  return roles
    .flatMap((role) =>
      buildReusableSessionOptions({
        sessions: candidates,
        role,
        roleLabel: workflowRoleLabel(task.taskWorkflow, role),
      }).map((option) => ({ ...option, role })),
    )
    .sort((left, right) => rank.get(left.value)! - rank.get(right.value)!)
    .map(({ secondaryLabel: _secondaryLabel, ...option }, index) =>
      index === 0 ? { ...option, secondaryLabel: "Latest" } : option,
    );
};

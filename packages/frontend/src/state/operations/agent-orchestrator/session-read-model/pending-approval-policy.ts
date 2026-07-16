import type { AgentSessionLiveReplyApprovalInput } from "@openducktor/contracts";
import {
  type AgentRole,
  buildReadOnlyPermissionRejectionMessage,
  isReadOnlyAgentRole,
} from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionCollection,
  getAgentSession,
  listAgentSessions,
} from "@/state/agent-session-collection";
import type { AgentApprovalRequest, AgentSessionState } from "@/types/agent-orchestrator";

export type PendingApprovalPolicyAction = {
  input: AgentSessionLiveReplyApprovalInput;
  role: AgentRole;
};

const responseSessionForApproval = (session: AgentSessionState, approval: AgentApprovalRequest) =>
  approval.responseSession ?? session;

const approvalIdentity = (session: AgentSessionState, approval: AgentApprovalRequest): string =>
  `${agentSessionIdentityKey(responseSessionForApproval(session, approval))}\u0000${approval.requestId}`;

const previousApprovalIdentities = (
  previous: AgentSessionCollection,
  session: AgentSessionState,
): Set<string> => {
  const previousSession = getAgentSession(previous, session);
  if (!previousSession) {
    return new Set();
  }
  return new Set(
    previousSession.pendingApprovals.map((approval) => approvalIdentity(previousSession, approval)),
  );
};

export const collectPendingApprovalPolicyActions = ({
  previous,
  next,
  repoPath,
}: {
  previous: AgentSessionCollection;
  next: AgentSessionCollection;
  repoPath: string;
}): PendingApprovalPolicyAction[] => {
  const actions: PendingApprovalPolicyAction[] = [];
  const scheduledApprovalIdentities = new Set<string>();

  for (const session of listAgentSessions(next)) {
    const role = session.role;
    if (!role || !isReadOnlyAgentRole(role)) {
      continue;
    }
    const previousIdentities = previousApprovalIdentities(previous, session);
    for (const approval of session.pendingApprovals) {
      if (approval.mutation !== "mutating") {
        continue;
      }
      const identity = approvalIdentity(session, approval);
      if (previousIdentities.has(identity) || scheduledApprovalIdentities.has(identity)) {
        continue;
      }
      scheduledApprovalIdentities.add(identity);
      const responseSession = responseSessionForApproval(session, approval);
      actions.push({
        role,
        input: {
          repoPath,
          runtimeKind: responseSession.runtimeKind,
          workingDirectory: responseSession.workingDirectory,
          externalSessionId: responseSession.externalSessionId,
          requestId: approval.requestId,
          outcome: "reject",
          message: buildReadOnlyPermissionRejectionMessage({ role, overrides: {} }),
        },
      });
    }
  }

  return actions;
};

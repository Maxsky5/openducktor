import type { AgentRole, AgentSessionLiveRef, AgentSessionScope } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import type { AgentWorkflowStep } from "@/components/features/agents/agent-studio-header.types";
import type { WorkspaceActivityProjection } from "@/features/workspace-activity/workspace-activity-projection";
import {
  foldWorkspaceSessionLiveFacts,
  resolveWorkspaceSessionOwnerKey,
} from "@/features/workspace-activity/workspace-activity-state";
import { ROLE_OPTIONS } from "@/lib/agent-role-presentation";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { compareAgentSessionRecency } from "@/lib/agent-session-options";
import { buildRoleWorkflowState } from "@/lib/agent-workflow-state";
import { roleWorkflowForTask } from "@/lib/task-agent-workflows";
import { workspaceSessionIdentity } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
} from "@/types/agent-orchestrator";
import type { SessionNavigationTarget } from "./session-navigation-target";

export type SessionPreviewPendingInput = {
  ref: AgentSessionLiveRef;
  scope: AgentSessionScope;
  approvals: readonly AgentApprovalRequest[];
  questions: readonly AgentQuestionRequest[];
  unavailableReason: string | null;
};

export type SessionPreviewModel = {
  model: AgentModelSelection | null;
  pending: SessionPreviewPendingInput[];
  steps: AgentWorkflowStep[];
  roleTargets: Map<AgentRole, SessionNavigationTarget>;
};

/** Build the open preview from cached records and the shared live stream. */
export const buildSessionPreviewModel = (
  entry: SessionNavigationEntry,
  projection: WorkspaceActivityProjection | null,
): SessionPreviewModel => {
  const { target, context } = entry;
  let identity: AgentSessionIdentity | null = null;
  if (target.kind === "task_session") identity = target.identity;
  else if (context.kind === "workspace") identity = workspaceSessionIdentity(context.session);
  const key = identity ? agentSessionIdentityKey(identity) : null;
  const live = key ? projection?.sessions.get(key)?.preview : undefined;
  const record =
    context.kind === "workspace"
      ? context.session
      : context.sessions.find((session) => agentSessionIdentityKey(session) === key);
  const model = live?.model ?? record?.selectedModel ?? null;
  const scope: AgentSessionScope =
    target.kind === "task_session"
      ? { kind: "workflow", taskId: target.taskId, role: target.role }
      : { kind: "repository" };
  return {
    model,
    pending: pendingInputs(projection, identity, scope),
    ...previewWorkflow(entry, projection),
  };
};

/** Keep child requests tied to their root conversation when replying. */
const pendingInputs = (
  projection: WorkspaceActivityProjection | null,
  identity: AgentSessionIdentity | null,
  scope: AgentSessionScope,
): SessionPreviewPendingInput[] => {
  if (!projection || !identity) return [];
  const key = agentSessionIdentityKey(identity);
  const pending: SessionPreviewPendingInput[] = [];
  for (const session of projection.sessions.values()) {
    const preview = session.preview;
    if (
      !preview ||
      resolveWorkspaceSessionOwnerKey(projection.sessions, session.key) !== key ||
      (preview.pendingApprovals.length === 0 && preview.pendingQuestions.length === 0)
    )
      continue;
    const source =
      session.key === key
        ? {}
        : {
            source: {
              kind: "subagent" as const,
              parentExternalSessionId: identity.externalSessionId,
              childExternalSessionId: preview.ref.externalSessionId,
            },
          };
    const fault = projection.faults.get(session.key);
    pending.push({
      ref: preview.ref,
      scope: preview.repositoryScope ?? scope,
      approvals: preview.pendingApprovals.map((request) => ({ ...request, ...source })),
      questions: preview.pendingQuestions.map((request) => ({ ...request, ...source })),
      unavailableReason:
        projection.unavailableReason ??
        (!projection.hasSnapshot ? "Waiting for live session state." : null) ??
        session.statusUnavailableReason ??
        (fault?.statusUnavailable ? fault.message : null),
    });
  }
  return pending;
};

const previewWorkflow = (
  entry: SessionNavigationEntry,
  projection: WorkspaceActivityProjection | null,
): Pick<SessionPreviewModel, "steps" | "roleTargets"> => {
  const roleTargets = new Map<AgentRole, SessionNavigationTarget>();
  const { context } = entry;
  if (context.kind !== "task") return { steps: [], roleTargets };
  const facts = projection
    ? foldWorkspaceSessionLiveFacts(projection.sessions, projection.faults)
    : null;
  const steps: AgentWorkflowStep[] = ROLE_OPTIONS.map((option) => {
    const latest = context.sessions
      .filter((session) => session.role === option.role)
      .toSorted(compareAgentSessionRecency)[0];
    const sessionKey = latest ? agentSessionIdentityKey(latest) : null;
    roleTargets.set(
      option.role,
      latest
        ? {
            kind: "task_session",
            workspaceId: entry.workspace.workspaceId,
            taskId: context.task.id,
            role: option.role,
            identity: toAgentSessionIdentity(latest),
          }
        : {
            kind: "task",
            workspaceId: entry.workspace.workspaceId,
            taskId: context.task.id,
            role: option.role,
          },
    );
    return {
      ...option,
      state: buildRoleWorkflowState({
        task: context.task,
        role: option.role,
        workflow: roleWorkflowForTask(context.task, option.role),
        liveSession: sessionKey ? (facts?.get(sessionKey)?.activityState ?? "none") : "none",
      }),
      sessionValue: sessionKey,
    };
  });
  return { steps, roleTargets };
};

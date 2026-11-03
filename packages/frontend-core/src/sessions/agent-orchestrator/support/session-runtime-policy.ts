import { resolveCodexEffectivePolicy, type SettingsSnapshot } from "@openducktor/contracts";
import type { TaskWorkflowRole } from "@openducktor/workflows";

import type {
  AgentSessionRuntimePolicy,
  AgentSessionScope,
  PolicyBoundSessionRef,
  RuntimeKind,
} from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "../../../types/agent-orchestrator";
import { toRuntimeSessionRefWithPolicy } from "./session-runtime-ref";
import { resolveSessionRuntimeScope } from "./session-runtime-scope";

type RuntimeSessionContextSource = {
  identity: AgentSessionIdentity;
  selectedModel: AgentSessionState["selectedModel"];
  sessionAssociation: AgentSessionState["sessionAssociation"];
};

export type LoadSettingsSnapshotForRuntimePolicy = () => Promise<SettingsSnapshot>;
export type LoadWorkflowRoleForRuntimePolicy = (
  taskId: string,
  roleId: string,
) => Promise<TaskWorkflowRole>;

export const resolveSettingsIndependentAgentSessionRuntimePolicy = (
  runtimeKind: RuntimeKind,
): AgentSessionRuntimePolicy | null => {
  if (runtimeKind === "opencode" || runtimeKind === "claude") {
    return { kind: runtimeKind };
  }
  return null;
};

export const resolveAgentSessionRuntimePolicy = async ({
  runtimeKind,
  sessionScope,
  loadSettingsSnapshot,
  loadWorkflowRole,
}: {
  runtimeKind: RuntimeKind;
  sessionScope?: AgentSessionScope | null;
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy;
  loadWorkflowRole?: LoadWorkflowRoleForRuntimePolicy;
}): Promise<AgentSessionRuntimePolicy> => {
  const settingsIndependentPolicy =
    resolveSettingsIndependentAgentSessionRuntimePolicy(runtimeKind);
  if (settingsIndependentPolicy) {
    return settingsIndependentPolicy;
  }
  if (sessionScope?.kind === "workflow" && !loadWorkflowRole)
    throw new Error(
      `Load workflow metadata for task "${sessionScope.taskId}" before resolving its runtime policy.`,
    );
  const [snapshot, workflowRole] = await Promise.all([
    loadSettingsSnapshot(),
    sessionScope?.kind === "workflow" && loadWorkflowRole
      ? loadWorkflowRole(sessionScope.taskId, sessionScope.role)
      : undefined,
  ]);
  const input: Parameters<typeof resolveAgentSessionRuntimePolicyFromSnapshot>[0] = {
    runtimeKind,
    snapshot,
  };
  if (sessionScope !== undefined) {
    input.sessionScope = sessionScope;
  }
  if (workflowRole !== undefined) input.workflowRole = workflowRole;
  return resolveAgentSessionRuntimePolicyFromSnapshot(input);
};

export const resolveAgentSessionRuntimePolicyFromSnapshot = ({
  runtimeKind,
  sessionScope,
  snapshot,
  workflowRole,
}: {
  runtimeKind: RuntimeKind;
  sessionScope?: AgentSessionScope | null;
  snapshot: SettingsSnapshot;
  workflowRole?: TaskWorkflowRole;
}): AgentSessionRuntimePolicy => {
  const settingsIndependentPolicy =
    resolveSettingsIndependentAgentSessionRuntimePolicy(runtimeKind);
  if (settingsIndependentPolicy) {
    return settingsIndependentPolicy;
  }
  if (runtimeKind !== "codex") {
    throw new Error(`Unsupported runtime kind '${runtimeKind}' for session runtime policy.`);
  }
  const role = sessionScope?.kind === "workflow" ? sessionScope.role : null;
  if (role !== null && workflowRole?.id !== role)
    throw new Error(
      `Workflow role "${role}" is unavailable. Reload the task metadata before opening this session.`,
    );
  return {
    kind: "codex",
    policy: resolveCodexEffectivePolicy(
      snapshot.agentRuntimes.codex,
      role,
      workflowRole?.workspaceAccess === "write",
    ),
  };
};

export const resolveRuntimeSessionContextRef = async (
  repoPath: string,
  session: RuntimeSessionContextSource,
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy,
  loadWorkflowRole?: LoadWorkflowRoleForRuntimePolicy,
): Promise<PolicyBoundSessionRef> => {
  const sessionScope = resolveSessionRuntimeScope(session.sessionAssociation);
  const policyInput: Parameters<typeof resolveAgentSessionRuntimePolicy>[0] = {
    runtimeKind: session.identity.runtimeKind,
    sessionScope,
    loadSettingsSnapshot,
  };
  if (loadWorkflowRole) policyInput.loadWorkflowRole = loadWorkflowRole;
  const runtimePolicy = await resolveAgentSessionRuntimePolicy(policyInput);
  const sessionRef: PolicyBoundSessionRef = {
    ...toRuntimeSessionRefWithPolicy(
      repoPath,
      { ...session.identity, selectedModel: session.selectedModel },
      runtimePolicy,
    ),
  };
  if (sessionScope) {
    sessionRef.sessionScope = sessionScope;
  }
  return sessionRef;
};

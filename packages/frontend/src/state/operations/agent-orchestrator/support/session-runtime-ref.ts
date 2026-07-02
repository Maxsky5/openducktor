import type {
  AgentSessionRef,
  AgentSessionRuntimePolicy,
  AgentSessionRuntimeRef,
  RuntimeWorkingDirectoryRef,
  WorkflowSessionRef,
} from "@openducktor/core";
import {
  requireRepoRuntimeRef,
  requireSessionWorkingDirectory,
  toAgentRuntimePolicyBinding,
  workflowAgentSessionScope,
} from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";

export type ObserveAgentSession = (session: AgentSessionRuntimeRef) => Promise<void>;
type RuntimeSessionContextSource = Pick<
  AgentSessionState,
  "externalSessionId" | "runtimeKind" | "workingDirectory" | "taskId" | "role"
> & {
  selectedModel?: AgentSessionState["selectedModel"];
};

export const toRuntimeWorkingDirectoryRef = ({
  repoPath,
  runtimeKind,
  workingDirectory,
  action,
}: {
  repoPath: string;
  runtimeKind: AgentSessionIdentity["runtimeKind"];
  workingDirectory: AgentSessionIdentity["workingDirectory"];
  action: string;
}): RuntimeWorkingDirectoryRef => {
  const runtimeRef = requireRepoRuntimeRef(
    {
      repoPath,
      runtimeKind,
    },
    action,
  );
  return {
    ...runtimeRef,
    workingDirectory: requireSessionWorkingDirectory(workingDirectory, action),
  };
};

export const toRuntimeSessionRef = (
  repoPath: string,
  session: AgentSessionIdentity,
): AgentSessionRef => {
  return {
    ...toRuntimeWorkingDirectoryRef({
      repoPath,
      runtimeKind: session.runtimeKind,
      workingDirectory: session.workingDirectory,
      action: `reach session '${session.externalSessionId}'`,
    }),
    externalSessionId: session.externalSessionId,
  };
};

export const toWorkflowSessionRef = (
  repoPath: string,
  session: RuntimeSessionContextSource,
): WorkflowSessionRef => {
  if (!session.role) {
    throw new Error(`Workflow session '${session.externalSessionId}' is missing a role.`);
  }
  return {
    ...toRuntimeSessionRef(repoPath, session),
    sessionScope: workflowAgentSessionScope(session.taskId, session.role),
  };
};

export const toRuntimeSessionRefWithPolicy = (
  repoPath: string,
  session: AgentSessionIdentity & { selectedModel?: AgentSessionState["selectedModel"] },
  runtimePolicy: AgentSessionRuntimePolicy,
): AgentSessionRuntimeRef => {
  return {
    ...toRuntimeSessionRef(repoPath, session),
    ...toAgentRuntimePolicyBinding({ runtimeKind: session.runtimeKind, runtimePolicy }),
    ...(session.selectedModel ? { model: session.selectedModel } : {}),
  };
};

export const toRuntimeSessionContextRef = toRuntimeSessionRefWithPolicy;

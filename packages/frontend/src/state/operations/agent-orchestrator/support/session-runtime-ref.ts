import type {
  AgentSessionRuntimePolicy,
  PolicyBoundSessionRef,
  RuntimeWorkingDirectoryRef,
  SessionRef,
  WorkflowSessionRef,
} from "@openducktor/core";
import {
  requireRepoRuntimeRef,
  requireSessionWorkingDirectory,
  toAgentRuntimePolicyBinding,
  workflowAgentSessionScope,
} from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";

export type ObserveAgentSession = (session: PolicyBoundSessionRef) => Promise<void>;
type RuntimeSessionContextSource = Pick<
  AgentSessionState,
  "externalSessionId" | "runtimeKind" | "workingDirectory" | "sessionAssociation"
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
): SessionRef => {
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
  if (session.sessionAssociation.kind !== "workflow") {
    throw new Error(
      `Cannot create a workflow runtime reference for session '${session.externalSessionId}' because its association is ${session.sessionAssociation.kind}.`,
    );
  }
  return {
    ...toRuntimeSessionRef(repoPath, session),
    sessionScope: workflowAgentSessionScope(
      session.sessionAssociation.taskId,
      session.sessionAssociation.role,
    ),
  };
};

export const toRuntimeSessionRefWithPolicy = (
  repoPath: string,
  session: AgentSessionIdentity & { selectedModel?: AgentSessionState["selectedModel"] },
  runtimePolicy: AgentSessionRuntimePolicy,
): PolicyBoundSessionRef => {
  return {
    ...toRuntimeSessionRef(repoPath, session),
    ...toAgentRuntimePolicyBinding({ runtimeKind: session.runtimeKind, runtimePolicy }),
    ...(() => {
      if (session.selectedModel) {
        return { model: session.selectedModel };
      }
      return {};
    })(),
  };
};

export const toRuntimeSessionContextRef = toRuntimeSessionRefWithPolicy;

import type {
  CodexAppServerApprovalsReviewer,
  CodexAppServerAskForApproval,
  CodexAppServerSandboxMode,
  CodexAppServerSandboxPolicy,
  CodexEffectivePolicy,
} from "@openducktor/contracts";
import type { AgentRole, AgentSessionRuntimePolicy, RuntimeKind } from "@openducktor/core";
import { assertAgentRuntimePolicyBinding } from "@openducktor/core";

export const READ_ONLY_ROLES = new Set<AgentRole>(["spec", "planner", "qa"]);

const codexWorkspaceWriteSandboxPolicy = (
  workingDirectory: string,
  networkAccess: boolean,
): CodexAppServerSandboxPolicy => ({
  type: "workspaceWrite",
  writableRoots: [workingDirectory],
  networkAccess,
  excludeTmpdirEnvVar: true,
  excludeSlashTmp: true,
});

export const codexSandboxPolicy = (
  policy: CodexEffectivePolicy,
  workingDirectory: string,
): CodexAppServerSandboxPolicy => {
  switch (policy.sandboxMode) {
    case "workspace-write":
      return codexWorkspaceWriteSandboxPolicy(workingDirectory, policy.commandNetworkAccess);
    case "read-only":
      return { type: "readOnly", networkAccess: policy.commandNetworkAccess };
    case "danger-full-access":
      return { type: "dangerFullAccess" };
  }
};

export const codexApprovalsReviewer = (
  policy: CodexEffectivePolicy,
): CodexAppServerApprovalsReviewer | null => policy.approvalsReviewer;

export type CodexPolicyLogOperation =
  | "thread/start"
  | "thread/resume"
  | "thread/fork"
  | "turn/start";

export type CodexNetworkAccessLogValue = boolean | "unrestricted";

export type CodexPolicyLogEntry = {
  operation: CodexPolicyLogOperation;
  runtimeId: string;
  threadId?: string;
  workingDirectory: string;
  sandboxMode: CodexAppServerSandboxMode;
  approvalPolicy: CodexAppServerAskForApproval;
  promptReviewer: CodexAppServerApprovalsReviewer | null;
  networkAccess: CodexNetworkAccessLogValue;
};

const codexNetworkAccessLogValue = (policy: CodexEffectivePolicy): CodexNetworkAccessLogValue =>
  policy.sandboxMode === "danger-full-access" ? "unrestricted" : policy.commandNetworkAccess;

export const codexPolicyLogEntry = ({
  operation,
  policy,
  runtimeId,
  threadId,
  workingDirectory,
}: {
  operation: CodexPolicyLogOperation;
  policy: CodexEffectivePolicy;
  runtimeId: string;
  threadId?: string;
  workingDirectory: string;
}): CodexPolicyLogEntry => ({
  operation,
  runtimeId,
  ...(threadId ? { threadId } : {}),
  workingDirectory,
  sandboxMode: policy.sandboxMode,
  approvalPolicy: policy.approvalPolicy,
  promptReviewer: codexApprovalsReviewer(policy),
  networkAccess: codexNetworkAccessLogValue(policy),
});

export type CodexTransportPolicy = {
  approvalPolicy: CodexAppServerAskForApproval;
  approvalsReviewer: CodexAppServerApprovalsReviewer | null;
  sandbox: CodexAppServerSandboxMode;
};

export const codexTransportPolicy = (policy: CodexEffectivePolicy): CodexTransportPolicy => ({
  approvalPolicy: policy.approvalPolicy,
  approvalsReviewer: codexApprovalsReviewer(policy),
  sandbox: policy.sandboxMode,
});

export const requireCodexRuntimePolicy = (
  runtimePolicy: AgentSessionRuntimePolicy | undefined,
  action: string,
): CodexEffectivePolicy => {
  if (!runtimePolicy) {
    throw new Error(`Cannot ${action} without resolved runtime policy.`);
  }
  if (runtimePolicy.kind !== "codex") {
    throw new Error(`Cannot ${action} with non-Codex runtime policy '${runtimePolicy.kind}'.`);
  }
  return runtimePolicy.policy;
};

export const assertCodexRuntimePolicyBinding = (
  input: { runtimeKind: RuntimeKind; runtimePolicy: AgentSessionRuntimePolicy },
  action: string,
): void => {
  assertAgentRuntimePolicyBinding(input, action);
  if (input.runtimeKind !== "codex") {
    throw new Error(`Cannot ${action} for non-Codex runtime '${input.runtimeKind}'.`);
  }
};

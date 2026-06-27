import type {
  CodexAppServerApprovalsReviewer,
  CodexAppServerAskForApproval,
  CodexAppServerSandboxMode,
  CodexAppServerSandboxPolicy,
  CodexEffectivePolicy,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";

export const READ_ONLY_ROLES = new Set<AgentRole>(["spec", "planner", "qa"]);

export const codexWorkspaceWriteSandboxPolicy = (
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
      return codexWorkspaceWriteSandboxPolicy(workingDirectory, policy.workspaceWriteNetworkAccess);
    case "read-only":
      return { type: "readOnly", networkAccess: false };
    case "danger-full-access":
      return { type: "dangerFullAccess" };
  }
};

export const codexApprovalsReviewer = (
  policy: CodexEffectivePolicy,
): CodexAppServerApprovalsReviewer | null => policy.approvalsReviewer;

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

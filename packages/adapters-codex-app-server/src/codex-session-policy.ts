import type {
  CodexAppServerAskForApproval,
  CodexAppServerSandboxMode,
  CodexAppServerSandboxPolicy,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";

export const READ_ONLY_ROLES = new Set<AgentRole>(["spec", "planner", "qa"]);

export const OPENDUCKTOR_CODEX_APPROVAL_POLICY: CodexAppServerAskForApproval = "on-request";
export const OPENDUCKTOR_CODEX_SANDBOX_MODE: CodexAppServerSandboxMode = "workspace-write";

export const codexWorkspaceWriteSandboxPolicy = (
  workingDirectory: string,
): CodexAppServerSandboxPolicy => ({
  type: "workspaceWrite",
  writableRoots: [workingDirectory],
  networkAccess: false,
  excludeTmpdirEnvVar: true,
  excludeSlashTmp: true,
});

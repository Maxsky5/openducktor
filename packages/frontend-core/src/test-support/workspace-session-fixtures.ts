import type { WorkspaceSession } from "@openducktor/contracts";

/** A saved chat in the repository root. Tests replace the fields they need. */
export const workspaceSessionRecord = (
  id: string,
  overrides: Partial<WorkspaceSession> = {},
): WorkspaceSession => ({
  id,
  runtimeKind: "codex",
  externalSessionId: `native-${id}`,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repos/alpha" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: `Chat ${id}`,
  manualTitle: null,
  targetBranch: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  archivedAt: null,
  ...overrides,
});

export const worktreeExecutionTarget = (
  overrides: Partial<{ branchName: string | null; worktreeState: "present" | "removed" }> = {},
): WorkspaceSession["executionTarget"] => ({
  kind: "local_worktree",
  workingDirectory: "/worktrees/alpha/chat",
  branchName: "odt/chat",
  worktreeState: "present",
  ...overrides,
});

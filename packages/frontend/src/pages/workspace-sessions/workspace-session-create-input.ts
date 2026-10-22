import {
  type GitBranch,
  type GitTargetBranch,
  type WorkspaceSessionCreateInput,
  type WorkspaceSessionWorktreeInput,
  workspaceSessionWorktreeInputSchema,
} from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { HostInvokeError } from "@openducktor/host-client";

export function buildWorkspaceSessionCreateInput({
  workspaceId,
  name,
  roleId,
  location,
  worktree,
  targetBranch,
  selection,
  selectedModelAvailable,
  rolesReady,
  availableBranches,
}: {
  workspaceId: string;
  name: string;
  roleId: string;
  location: WorkspaceSessionCreateInput["location"];
  worktree: WorkspaceSessionWorktreeInput;
  targetBranch: GitTargetBranch | null;
  selection: AgentModelSelection | null;
  selectedModelAvailable: boolean;
  rolesReady: boolean;
  availableBranches: readonly GitBranch[] | null;
}): WorkspaceSessionCreateInput | null {
  if (!selection?.runtimeKind || !selectedModelAvailable || !rolesReady || !targetBranch)
    return null;
  const input: WorkspaceSessionCreateInput = {
    workspaceId,
    runtimeKind: selection.runtimeKind,
    selectedModel: { ...selection, runtimeKind: selection.runtimeKind },
    customAgentRoleId: roleId === "none" ? null : roleId,
    location,
    manualTitle: name,
    targetBranch,
  };
  if (location === "local_repo_root") return input;
  const parsed = workspaceSessionWorktreeInputSchema.safeParse(worktree);
  if (!parsed.success) return null;
  if (parsed.data.mode === "from_branch") {
    const selected = availableBranches?.find(
      (branch) => !branch.isRemote && branch.name === parsed.data.branchName,
    );
    if (!selected || selected.worktreePath) return null;
  }
  input.worktree = parsed.data;
  return input;
}

export function workspaceSessionValidationError(error: Error | null) {
  return error instanceof HostInvokeError && error.failure?.kind === "workspace_session_validation"
    ? { field: error.failure.field, message: error.message }
    : null;
}

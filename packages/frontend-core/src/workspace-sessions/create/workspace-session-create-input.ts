import {
  type GitBranch,
  type GitTargetBranch,
  type WorkspaceSessionCreateInput,
  type WorkspaceSessionLocation,
  type WorkspaceSessionWorktreeInput,
  workspaceSessionWorktreeInputSchema,
} from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { HostInvokeError } from "@openducktor/host-client";

/** Builds the request for the active location only. Choices of other locations stay out of it. */
export function buildWorkspaceSessionCreateInput({
  workspaceId,
  name,
  roleId,
  location,
  worktree,
  existingWorktree,
  targetBranch,
  selection,
  selectedModelAvailable,
  rolesReady,
  availableBranches,
}: {
  workspaceId: string;
  name: string;
  roleId: string;
  location: WorkspaceSessionLocation;
  worktree: WorkspaceSessionWorktreeInput;
  /** The selected existing worktree, once a finished read lists it. */
  existingWorktree: string | null;
  targetBranch: GitTargetBranch | null;
  selection: AgentModelSelection | null;
  selectedModelAvailable: boolean;
  rolesReady: boolean;
  availableBranches: readonly GitBranch[] | null;
}): WorkspaceSessionCreateInput | null {
  if (!selection?.runtimeKind || !selectedModelAvailable || !rolesReady || !targetBranch)
    return null;
  const common = {
    workspaceId,
    runtimeKind: selection.runtimeKind,
    selectedModel: { ...selection, runtimeKind: selection.runtimeKind },
    customAgentRoleId: roleId === "none" ? null : roleId,
    manualTitle: name,
    targetBranch,
  };
  switch (location) {
    case "local_repo_root":
      return { ...common, location };
    case "local_worktree": {
      const parsed = workspaceSessionWorktreeInputSchema.safeParse(worktree);
      if (!parsed.success) return null;
      if (parsed.data.mode === "from_branch") {
        const selected = availableBranches?.find(
          (branch) => !branch.isRemote && branch.name === parsed.data.branchName,
        );
        if (!selected || selected.worktreePath) return null;
      }
      return { ...common, location, worktree: parsed.data };
    }
    case "existing_worktree":
      if (!existingWorktree) return null;
      return { ...common, location, existingWorktree: { workingDirectory: existingWorktree } };
  }
}

export function workspaceSessionValidationError(error: Error | null) {
  return error instanceof HostInvokeError && error.failure?.kind === "workspace_session_validation"
    ? { field: error.failure.field, message: error.message }
    : null;
}

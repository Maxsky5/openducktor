import {
  workspaceSessionBranchNameSchema,
  workspaceSessionWorktreeNameSchema,
  type WorkspaceSessionWorktreeInput,
} from "@openducktor/contracts";

export function newWorktreeBranchState(
  value: WorkspaceSessionWorktreeInput,
  branchPrefix: string | undefined,
) {
  const parsedName = workspaceSessionWorktreeNameSchema.safeParse(value.name);
  const branchError =
    value.branchName !== null &&
    value.branchName.length > 0 &&
    !workspaceSessionBranchNameSchema.safeParse(value.branchName).success;
  const defaultBranch =
    branchPrefix !== undefined && parsedName.success ? `${branchPrefix}/${parsedName.data}` : "";
  return { branchError, defaultBranch };
}

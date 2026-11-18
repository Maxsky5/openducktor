import type { WorkspaceRef } from "@openducktor/contracts";
import { HostValidationError } from "../effect/host-errors";
import { normalizePathForComparison } from "./path-comparison";

export const workspaceMatchesScope = <Workspace extends WorkspaceRef>(
  scope: WorkspaceRef,
  workspace: Workspace | undefined,
): workspace is Workspace =>
  workspace?.workspaceId === scope.workspaceId &&
  normalizePathForComparison(workspace.repoPath) === normalizePathForComparison(scope.repoPath);

export const workspaceScopeMismatch = () =>
  new HostValidationError({
    field: "workspaceId",
    message:
      "The workspace no longer matches this repository. Reload the workspace before retrying.",
  });

export const workspaceLifecyclePathChange = (
  { repoPath, workspaceId }: WorkspaceRef,
  expectedRepoPath: string,
) =>
  repoPath === expectedRepoPath
    ? undefined
    : new HostValidationError({
        field: "repoPath",
        message: `Workspace ${workspaceId} changed since the dialog opened. Reload workspaces and retry.`,
        details: { expectedRepoPath, actualRepoPath: repoPath },
      });

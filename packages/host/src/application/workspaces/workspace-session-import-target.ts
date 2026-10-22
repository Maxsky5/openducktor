import type { WorkspaceSessionExecutionTarget } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import { classifyWorkspaceCheckout, type WorkspaceCheckoutGitPort } from "./workspace-checkout";

export const invalidImport = (message: string) =>
  new HostValidationError({ field: "externalSessionId", message });

/** Reads the execution target of an imported conversation from its working directory. */
export const readWorkspaceSessionImportTarget = (
  git: Pick<GitPort, "canonicalizePath" | "getCurrentBranch"> & WorkspaceCheckoutGitPort,
  repoPath: string,
  workingDirectory: string,
) =>
  Effect.gen(function* () {
    const canonical = yield* git.canonicalizePath(workingDirectory);
    const checkout = yield* classifyWorkspaceCheckout(git, {
      canonicalRepoPath: repoPath,
      canonicalDirectory: canonical,
    });
    switch (checkout) {
      case "not_git_directory":
        return yield* invalidImport(
          `Directory is unavailable: ${workingDirectory}. Restore it before importing.`,
        );
      case "outside_workspace":
        return yield* invalidImport(
          "The source directory is not a registered worktree of this workspace.",
        );
      case "local_repo_root":
        return {
          kind: "local_repo_root",
          workingDirectory,
        } satisfies WorkspaceSessionExecutionTarget;
      case "local_worktree": {
        const branch = yield* git.getCurrentBranch(canonical);
        return {
          kind: "local_worktree",
          workingDirectory,
          branchName: branch.detached ? null : (branch.name ?? null),
          worktreeState: "present",
        } satisfies WorkspaceSessionExecutionTarget;
      }
      default: {
        const unhandledCheckout: never = checkout;
        return yield* invalidImport(`Unsupported workspace checkout: ${String(unhandledCheckout)}`);
      }
    }
  });

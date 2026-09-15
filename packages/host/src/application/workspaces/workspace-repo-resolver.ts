import { Effect } from "effect";
import { pathStartsWith } from "@openducktor/path-support";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { HostValidationError, type HostValidationErrorAggregate } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

export const createWorkspaceRepoResolver =
  ({
    gitPort,
    workspaceSettingsService,
  }: {
    gitPort: Pick<GitPort, "isGitRepository" | "listWorktrees">;
    workspaceSettingsService: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
  }) =>
  (workingDirectory: string): Effect.Effect<string | null, HostValidationErrorAggregate> =>
    Effect.gen(function* () {
      if (!(yield* gitPort.isGitRepository(workingDirectory))) return null;
      const catalog = yield* workspaceSettingsService.getWorkspaceCatalog();
      const workspaces = [
        ...catalog.openWorkspaces,
        ...catalog.closedWorkspaces,
        ...catalog.incompleteRemovals.map((removal) => removal.workspace),
      ];
      const workingDirectoryComparison = normalizePathForComparison(workingDirectory);
      const exactWorkspace = workspaces.find(
        (workspace) =>
          normalizePathForComparison(workspace.repoPath) === workingDirectoryComparison,
      );
      if (exactWorkspace) return exactWorkspace.repoPath;
      let baseWorkspace: (typeof workspaces)[number] | undefined;
      let baseLength = -1;
      for (const workspace of workspaces) {
        if (workspace.effectiveWorktreeBasePath === null) continue;
        const basePath = normalizePathForComparison(workspace.effectiveWorktreeBasePath);
        if (!pathStartsWith(workingDirectoryComparison, basePath)) continue;
        if (basePath.length > baseLength) {
          baseWorkspace = workspace;
          baseLength = basePath.length;
        } else if (basePath.length === baseLength) {
          baseWorkspace = undefined;
        }
      }
      if (baseLength >= 0 && !baseWorkspace) {
        return yield* new HostValidationError({
          message: `Multiple workspace worktree bases match ${workingDirectory}. Use distinct worktree bases and retry.`,
          field: "workingDirectory",
        });
      }
      if (baseWorkspace) return baseWorkspace.repoPath;
      const worktreePaths = new Set(
        (yield* gitPort.listWorktrees(workingDirectory)).map((worktree) =>
          normalizePathForComparison(worktree.worktreePath),
        ),
      );
      const gitWorkspaces = workspaces.filter((workspace) =>
        worktreePaths.has(normalizePathForComparison(workspace.repoPath)),
      );
      if (gitWorkspaces.length > 1) {
        return yield* new HostValidationError({
          message: `Multiple workspaces share the Git repository for ${workingDirectory}. Use a current workspace worktree base and retry.`,
          field: "workingDirectory",
        });
      }
      return gitWorkspaces[0]?.repoPath ?? null;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof HostValidationError
          ? cause
          : new HostValidationError({
              message: `Cannot verify the repository for ${workingDirectory}. Check the path and retry.`,
              field: "workingDirectory",
              cause,
            }),
      ),
    );

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
      const baseWorkspace = workspaces.find(
        (workspace) =>
          workspace.effectiveWorktreeBasePath !== null &&
          pathStartsWith(
            workingDirectoryComparison,
            normalizePathForComparison(workspace.effectiveWorktreeBasePath),
          ),
      );
      if (baseWorkspace) return baseWorkspace.repoPath;
      const worktreePaths = new Set(
        (yield* gitPort.listWorktrees(workingDirectory)).map((worktree) =>
          normalizePathForComparison(worktree.worktreePath),
        ),
      );
      return (
        workspaces.find((workspace) =>
          worktreePaths.has(normalizePathForComparison(workspace.repoPath)),
        )?.repoPath ?? null
      );
    }).pipe(
      Effect.mapError(
        (cause) =>
          new HostValidationError({
            message: `Cannot verify the repository for ${workingDirectory}. Check the path and retry.`,
            field: "workingDirectory",
            cause,
          }),
      ),
    );

import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { HostValidationError, type HostValidationErrorAggregate } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

export const createProspectiveWorkspaceTargetValidator =
  ({
    gitPort,
    worktreeFiles,
    workspaceSettingsService,
  }: {
    gitPort: Pick<GitPort, "listWorktrees">;
    worktreeFiles: Pick<WorktreeFilePort, "resolvePathWithinRoot">;
    workspaceSettingsService: Pick<
      WorkspaceSettingsService,
      "getRepoConfigByRepoPath" | "getWorkspaceCatalog"
    >;
  }) =>
  (repoPath: string, workingDirectory: string): Effect.Effect<void, HostValidationErrorAggregate> =>
    Effect.gen(function* () {
      const sourceWorkspace = yield* workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const catalog = yield* workspaceSettingsService.getWorkspaceCatalog();
      const workspaces = [
        ...catalog.openWorkspaces,
        ...catalog.closedWorkspaces,
        ...catalog.incompleteRemovals.map((removal) => removal.workspace),
      ];
      for (const workspace of workspaces) {
        if (workspace.workspaceId === sourceWorkspace.workspaceId) continue;
        const registeredWorktrees = yield* gitPort.listWorktrees(workspace.repoPath);
        const roots = [
          workspace.repoPath,
          workspace.effectiveWorktreeBasePath,
          ...registeredWorktrees.map((worktree) => worktree.worktreePath),
        ].filter((root): root is string => root !== null);
        for (const root of roots) {
          const [resolvedRoot, resolvedTarget] = yield* Effect.all([
            worktreeFiles.resolvePathWithinRoot(root, root),
            worktreeFiles.resolvePathWithinRoot(root, workingDirectory),
          ]);
          if (
            resolvedTarget.kind === "descendant" ||
            normalizePathForComparison(resolvedTarget.canonicalPath) ===
              normalizePathForComparison(resolvedRoot.canonicalPath)
          ) {
            return yield* new HostValidationError({
              message: `Working directory ${workingDirectory} belongs to workspace ${workspace.repoPath}, not ${repoPath}.`,
              field: "workingDirectory",
            });
          }
        }
      }
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof HostValidationError
          ? cause
          : new HostValidationError({
              message: `Cannot verify the working directory ${workingDirectory}. Check the path and retry.`,
              field: "workingDirectory",
              cause,
            }),
      ),
    );

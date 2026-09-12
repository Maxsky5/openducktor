import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import type { RuntimeWorkingDirectoryDependencies } from "./runtime-working-directory";

export type RuntimeHistoryWorkingDirectoryDependencies = RuntimeWorkingDirectoryDependencies & {
  worktreeFiles: Pick<WorktreeFilePort, "resolvePathWithinRoot">;
};

export const requireManagedHistoryDirectory = (
  dependencies: RuntimeHistoryWorkingDirectoryDependencies,
  input: { repoPath: string; workingDirectory: string },
) =>
  Effect.gen(function* () {
    const repoPath = yield* dependencies.settingsConfig.canonicalizePath(input.repoPath);
    const repoConfig =
      yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const worktreeBasePath =
      repoConfig.worktreeBasePath === undefined
        ? dependencies.settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId)
        : dependencies.settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath);
    const legacyBasePath = dependencies.settingsConfig.defaultRepoWorktreeBasePath(repoPath);
    for (const root of [worktreeBasePath, legacyBasePath]) {
      const resolved = yield* dependencies.worktreeFiles.resolvePathWithinRoot(
        root,
        input.workingDirectory,
      );
      if (resolved.kind === "descendant" && !resolved.isSymlink) return;
    }
    return yield* new HostValidationError({
      field: "workingDirectory",
      message:
        "The recorded session directory is outside the managed worktrees. Select a session recorded for this workspace.",
      details: input,
    });
  });

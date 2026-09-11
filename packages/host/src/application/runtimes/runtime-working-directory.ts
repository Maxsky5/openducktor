import { pathStartsWith } from "@openducktor/path-support";
import { Effect } from "effect";
import {
  hasNestedNodeErrorCode,
  type HostOperationErrorAggregate,
  HostValidationError,
} from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-model";

export type RuntimeWorkingDirectoryDependencies = {
  settingsConfig: Pick<
    SettingsConfigPort,
    | "canonicalizePath"
    | "defaultRepoWorktreeBasePath"
    | "defaultWorktreeBasePath"
    | "resolveConfiguredPath"
  >;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
};

export const requireRuntimeWorkingDirectory = (
  dependencies: RuntimeWorkingDirectoryDependencies,
  input: { repoPath: string; workingDirectory: string },
) =>
  Effect.gen(function* () {
    const canonicalRepoPath = yield* dependencies.settingsConfig.canonicalizePath(input.repoPath);
    const canonicalWorkingDirectory = yield* dependencies.settingsConfig.canonicalizePath(
      input.workingDirectory,
    );
    if (pathStartsWith(canonicalWorkingDirectory, canonicalRepoPath)) {
      return;
    }

    const repoConfig =
      yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(canonicalRepoPath);
    const worktreeBasePath =
      repoConfig.worktreeBasePath !== undefined
        ? dependencies.settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
        : dependencies.settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
    const canonicalWorktreeBasePath = yield* canonicalizeWorktreeBasePath(
      dependencies.settingsConfig,
      worktreeBasePath,
    );
    if (
      canonicalWorktreeBasePath !== null &&
      pathStartsWith(canonicalWorkingDirectory, canonicalWorktreeBasePath)
    ) {
      return;
    }

    const canonicalLegacyWorktreeBasePath = yield* canonicalizeWorktreeBasePath(
      dependencies.settingsConfig,
      dependencies.settingsConfig.defaultRepoWorktreeBasePath(canonicalRepoPath),
    );
    if (
      canonicalLegacyWorktreeBasePath !== null &&
      pathStartsWith(canonicalWorkingDirectory, canonicalLegacyWorktreeBasePath)
    ) {
      return;
    }

    return yield* Effect.fail(
      new HostValidationError({
        field: "workingDirectory",
        message: `Working directory '${input.workingDirectory}' is outside the selected workspace.`,
        details: {
          repoPath: input.repoPath,
          workingDirectory: input.workingDirectory,
        },
      }),
    );
  });

function canonicalizeWorktreeBasePath(
  settingsConfig: RuntimeWorkingDirectoryDependencies["settingsConfig"],
  worktreeBasePath: string,
): Effect.Effect<string | null, HostOperationErrorAggregate> {
  // A repository can use its legacy root before the current worktree base exists.
  return settingsConfig
    .canonicalizePath(worktreeBasePath)
    .pipe(
      Effect.catchTag("HostOperationError", (error) =>
        hasNestedNodeErrorCode(error, "ENOENT") ? Effect.succeed(null) : Effect.fail(error),
      ),
    );
}

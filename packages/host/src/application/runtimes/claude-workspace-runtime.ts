import { pathStartsWith } from "@openducktor/path-support";
import { Effect } from "effect";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-model";

export type ClaudeWorkspaceWorkingDirectoryDependencies = {
  settingsConfig: Pick<
    SettingsConfigPort,
    | "canonicalizePath"
    | "defaultRepoWorktreeBasePath"
    | "defaultWorktreeBasePath"
    | "resolveConfiguredPath"
  >;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
};

export const requireLiveClaudeWorkspaceRuntime = (
  runtimeRegistry: RuntimeRegistryPort,
  input: { repoPath: string; runtimeKind: string },
) =>
  Effect.gen(function* () {
    const runtime = yield* runtimeRegistry
      .findWorkspaceRuntime({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
      })
      .pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "claudeRuntime.findWorkspaceRuntime", {
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
          }),
        ),
      );
    if (!runtime) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `No live Claude workspace runtime found for repo '${input.repoPath}'.`,
          details: { repoPath: input.repoPath, runtimeKind: input.runtimeKind },
        }),
      );
    }
    return runtime;
  });

export const requireClaudeWorkspaceWorkingDirectory = (
  dependencies: ClaudeWorkspaceWorkingDirectoryDependencies,
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
    const canonicalWorktreeBasePath =
      yield* dependencies.settingsConfig.canonicalizePath(worktreeBasePath);
    if (pathStartsWith(canonicalWorkingDirectory, canonicalWorktreeBasePath)) {
      return;
    }

    const canonicalLegacyWorktreeBasePath = yield* dependencies.settingsConfig.canonicalizePath(
      dependencies.settingsConfig.defaultRepoWorktreeBasePath(canonicalRepoPath),
    );
    if (pathStartsWith(canonicalWorkingDirectory, canonicalLegacyWorktreeBasePath)) {
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

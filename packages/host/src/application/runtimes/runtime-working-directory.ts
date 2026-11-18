import { pathStartsWith } from "@openducktor/path-support";
import type { AgentSessionScope } from "@openducktor/contracts";
import { Effect } from "effect";
import { getScopedRepoConfig } from "../workspaces/scoped-repo-config";
import {
  hasNestedNodeErrorCode,
  type HostOperationErrorAggregate,
  HostValidationError,
} from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { managedWorktreeRoots } from "../git/managed-worktree-roots";
import {
  classifyWorkspaceCheckout,
  type WorkspaceCheckoutGitPort,
} from "../git/workspace-checkout";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-model";

export type RuntimeWorkingDirectoryDependencies = {
  gitPort: WorkspaceCheckoutGitPort;
  settingsConfig: Pick<
    SettingsConfigPort,
    | "canonicalizePath"
    | "defaultRepoWorktreeBasePath"
    | "defaultWorktreeBasePath"
    | "resolveConfiguredPath"
  >;
  workspaceSettingsService: Pick<
    WorkspaceSettingsService,
    "getRepoConfig" | "getRepoConfigByRepoPath"
  >;
};
export type RuntimeWorkingDirectoryInput = {
  repoPath: string;
  workingDirectory: string;
  sessionScope?: AgentSessionScope | undefined;
};

export const resolveRuntimeRepoConfig = (
  settings: RuntimeWorkingDirectoryDependencies["workspaceSettingsService"],
  input: Pick<RuntimeWorkingDirectoryInput, "repoPath" | "sessionScope">,
) => {
  const workspaceId = input.sessionScope?.workspaceId;
  return workspaceId === undefined
    ? settings.getRepoConfigByRepoPath(input.repoPath)
    : getScopedRepoConfig(settings, { workspaceId, repoPath: input.repoPath });
};

export const requireRuntimeWorkingDirectory = (
  dependencies: RuntimeWorkingDirectoryDependencies,
  input: RuntimeWorkingDirectoryInput,
) =>
  Effect.gen(function* () {
    const canonicalRepoPath = yield* dependencies.settingsConfig.canonicalizePath(input.repoPath);
    const repoConfig = yield* resolveRuntimeRepoConfig(dependencies.workspaceSettingsService, {
      ...input,
      repoPath: canonicalRepoPath,
    });
    const canonicalWorkingDirectory = yield* dependencies.settingsConfig.canonicalizePath(
      input.workingDirectory,
    );
    if (pathStartsWith(canonicalWorkingDirectory, canonicalRepoPath)) {
      return;
    }

    for (const root of managedWorktreeRoots(
      dependencies.settingsConfig,
      repoConfig,
      canonicalRepoPath,
    )) {
      const canonicalRoot = yield* canonicalizeWorktreeBasePath(dependencies.settingsConfig, root);
      if (canonicalRoot !== null && pathStartsWith(canonicalWorkingDirectory, canonicalRoot))
        return;
    }

    // External worktrees match only at their root, the same as session import.
    const checkout = yield* classifyWorkspaceCheckout(dependencies.gitPort, {
      canonicalRepoPath,
      canonicalDirectory: canonicalWorkingDirectory,
    });
    if (checkout === "local_worktree") {
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

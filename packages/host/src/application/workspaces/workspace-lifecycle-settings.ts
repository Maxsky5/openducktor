import {
  globalConfigSchema,
  type RepoConfig,
  type WorkspacePathResolution,
  type WorkspaceRemovalRecord,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import {
  buildWorkspaceCatalog,
  firstOpenWorkspaceId,
  workspacePathResolution,
} from "./workspace-catalog-model";
import {
  loadGlobalConfig,
  requireConfiguredWorkspace,
  touchRecentWorkspace,
  validateGitRepoPath,
  type WorkspaceSettingsService,
} from "./workspace-settings-model";

type WorkspaceLifecycleSettingsMethods = Pick<
  WorkspaceSettingsService,
  | "getWorkspaceCatalog"
  | "closeWorkspace"
  | "reopenWorkspace"
  | "removeWorkspaceRegistration"
  | "resolveWorkspacePath"
  | "beginWorkspaceRemoval"
  | "recordWorkspaceRemovalProgress"
>;

const incompleteRemovalError = (workspaceId: string): HostValidationError =>
  new HostValidationError({
    message: `Workspace removal is incomplete for ${workspaceId}. Retry removal from the workspace rail before using it.`,
    field: "workspaceId",
  });

const requireWorkspace = (
  config: Parameters<typeof requireConfiguredWorkspace>[0],
  workspaceId: string,
) =>
  Effect.try({
    try: () => requireConfiguredWorkspace(config, workspaceId),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

const assertExpectedRepoPath = (
  workspaceId: string,
  repoConfig: RepoConfig,
  expectedRepoPath: string,
) => {
  if (repoConfig.repoPath === expectedRepoPath) {
    return Effect.void;
  }
  return Effect.fail(
    new HostValidationError({
      message: `Workspace ${workspaceId} changed since the dialog opened. Reload workspaces and retry.`,
      field: "repoPath",
      details: { expectedRepoPath, actualRepoPath: repoConfig.repoPath },
    }),
  );
};

const readCatalog = (
  settingsConfig: SettingsConfigPort,
  config: Parameters<typeof buildWorkspaceCatalog>[1],
) =>
  Effect.try({
    try: () => buildWorkspaceCatalog(settingsConfig, config),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

const writeConfig = (
  settingsConfig: SettingsConfigPort,
  config: Parameters<typeof globalConfigSchema.parse>[0],
) =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => globalConfigSchema.parse(config),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    yield* settingsConfig.writeConfig(parsed);
  });

export const createWorkspaceLifecycleSettingsMethods = (
  settingsConfig: SettingsConfigPort,
): WorkspaceLifecycleSettingsMethods => ({
  getWorkspaceCatalog() {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      return yield* readCatalog(settingsConfig, config);
    });
  },
  closeWorkspace(workspaceId, expectedRepoPath) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const repoConfig = yield* requireWorkspace(config, workspaceId);
      yield* assertExpectedRepoPath(workspaceId, repoConfig, expectedRepoPath);
      if (repoConfig.removal) {
        return yield* Effect.fail(incompleteRemovalError(workspaceId));
      }

      config.workspaces[workspaceId] = { ...repoConfig, closed: true };
      if (config.activeWorkspace === workspaceId) {
        const nextActiveWorkspace = firstOpenWorkspaceId(config, workspaceId);
        if (nextActiveWorkspace === undefined) {
          delete config.activeWorkspace;
        } else {
          config.activeWorkspace = nextActiveWorkspace;
        }
      }
      yield* writeConfig(settingsConfig, config);
      return yield* readCatalog(settingsConfig, config);
    });
  },
  reopenWorkspace(workspaceId, expectedRepoPath) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const repoConfig = yield* requireWorkspace(config, workspaceId);
      yield* assertExpectedRepoPath(workspaceId, repoConfig, expectedRepoPath);
      if (repoConfig.removal) {
        return yield* Effect.fail(incompleteRemovalError(workspaceId));
      }

      const canonicalRepoPath = yield* validateGitRepoPath(settingsConfig, repoConfig.repoPath);
      if (canonicalRepoPath !== repoConfig.repoPath) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace repository path resolved to a different location: ${canonicalRepoPath}.`,
            field: "repoPath",
            details: { expectedRepoPath: repoConfig.repoPath, canonicalRepoPath },
          }),
        );
      }

      config.workspaces[workspaceId] = { ...repoConfig, closed: false };
      config.activeWorkspace = workspaceId;
      touchRecentWorkspace(config, workspaceId);
      yield* writeConfig(settingsConfig, config);
      return yield* readCatalog(settingsConfig, config);
    });
  },
  removeWorkspaceRegistration(workspaceId, expectedRepoPath) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const repoConfig = yield* requireWorkspace(config, workspaceId);
      yield* assertExpectedRepoPath(workspaceId, repoConfig, expectedRepoPath);

      delete config.workspaces[workspaceId];
      config.workspaceOrder = config.workspaceOrder.filter((id) => id !== workspaceId);
      config.recentWorkspaces = config.recentWorkspaces.filter((id) => id !== workspaceId);
      if (config.activeWorkspace === workspaceId) {
        const nextActiveWorkspace = firstOpenWorkspaceId(config);
        if (nextActiveWorkspace === undefined) {
          delete config.activeWorkspace;
        } else {
          config.activeWorkspace = nextActiveWorkspace;
        }
      }
      yield* writeConfig(settingsConfig, config);
      return yield* readCatalog(settingsConfig, config);
    });
  },
  resolveWorkspacePath(rawRepoPath) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const canonicalRepoPath = yield* settingsConfig.canonicalizePath(rawRepoPath);
      const repoConfig = Object.values(config.workspaces).find(
        (workspace) => workspace.repoPath === canonicalRepoPath,
      );
      if (!repoConfig) {
        return { kind: "new" as const } satisfies WorkspacePathResolution;
      }
      return yield* Effect.try({
        try: () => workspacePathResolution(settingsConfig, config, repoConfig),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    });
  },
  beginWorkspaceRemoval(input) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const repoConfig = yield* requireWorkspace(config, input.workspaceId);
      yield* assertExpectedRepoPath(input.workspaceId, repoConfig, input.expectedRepoPath);
      if (repoConfig.removal) {
        const canChangeChoice =
          repoConfig.removal.phase === "worktrees" &&
          repoConfig.removal.removedWorktrees.length === 0 &&
          repoConfig.removal.removeTaskWorktrees !== input.removeTaskWorktrees;
        if (!canChangeChoice) {
          return repoConfig.removal;
        }
        const removal: WorkspaceRemovalRecord = {
          ...repoConfig.removal,
          removeTaskWorktrees: input.removeTaskWorktrees,
          phase: input.removeTaskWorktrees ? "worktrees" : "task_store",
          lastFailure: null,
        };
        config.workspaces[input.workspaceId] = { ...repoConfig, removal };
        yield* writeConfig(settingsConfig, config);
        return removal;
      }

      const removal: WorkspaceRemovalRecord = {
        version: 1,
        operationId: globalThis.crypto.randomUUID(),
        removeTaskWorktrees: input.removeTaskWorktrees,
        phase: input.removeTaskWorktrees ? "worktrees" : "task_store",
        removedWorktrees: [],
        startedAt: new Date().toISOString(),
        lastFailure: null,
      };
      config.workspaces[input.workspaceId] = { ...repoConfig, removal };
      yield* writeConfig(settingsConfig, config);
      return removal;
    });
  },
  recordWorkspaceRemovalProgress(input) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const repoConfig = yield* requireWorkspace(config, input.workspaceId);
      if (!repoConfig.removal) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace removal is not in progress for ${input.workspaceId}.`,
            field: "workspaceId",
          }),
        );
      }

      config.workspaces[input.workspaceId] = {
        ...repoConfig,
        removal: {
          ...repoConfig.removal,
          phase: input.phase,
          removedWorktrees: input.removedWorktrees,
          lastFailure: input.lastFailure,
        },
      };
      yield* writeConfig(settingsConfig, config);
    });
  },
});

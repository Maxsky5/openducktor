import type { WorkspaceCatalogRepo } from "../../ports/settings-config-port";
import {
  globalConfigSchema,
  type GlobalConfig,
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

export const createWorkspaceLifecycleSettingsMethods = (
  settingsConfig: SettingsConfigPort,
): WorkspaceLifecycleSettingsMethods => {
  const getWorkspaceCatalog: WorkspaceLifecycleSettingsMethods["getWorkspaceCatalog"] = () =>
    Effect.gen(function* () {
      const snapshot = yield* settingsConfig.readWorkspaceCatalogSnapshot();
      return yield* Effect.try({
        try: () => buildWorkspaceCatalog(settingsConfig, snapshot),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    });
  const edit = (
    workspaceId: string,
    change: (config: GlobalConfig, catalog: readonly WorkspaceCatalogRepo[]) => void,
  ) =>
    settingsConfig.updateConfig(
      (current, catalog) => {
        const next = structuredClone(current);
        change(next, catalog);
        return globalConfigSchema.parse(next);
      },
      [workspaceId],
    );
  return {
    getWorkspaceCatalog,
    closeWorkspace(workspaceId, expectedRepoPath) {
      return Effect.gen(function* () {
        yield* edit(workspaceId, (config, catalog) => {
          const workspace = requireWorkspace(config, workspaceId, expectedRepoPath);
          requireNoRemoval(workspace);
          config.workspaces[workspaceId] = { ...workspace, closed: true };
          moveActiveSelection(config, workspaceId, catalog);
        });
        return yield* getWorkspaceCatalog();
      });
    },
    reopenWorkspace(workspaceId, expectedRepoPath) {
      return Effect.gen(function* () {
        const before = yield* settingsConfig.readConfig([workspaceId]);
        yield* Effect.try({
          try: () => requireNoRemoval(requireWorkspace(before, workspaceId, expectedRepoPath)),
          catch: (cause) =>
            cause instanceof HostValidationError
              ? cause
              : new HostValidationError({ message: String(cause), cause }),
        });
        const canonicalRepoPath = yield* validateGitRepoPath(settingsConfig, expectedRepoPath);
        if (canonicalRepoPath !== expectedRepoPath)
          return yield* new HostValidationError({
            message: `Workspace repository path resolved to a different location: ${canonicalRepoPath}.`,
            field: "repoPath",
            details: { expectedRepoPath, canonicalRepoPath },
          });
        yield* edit(workspaceId, (config) => {
          const workspace = requireWorkspace(config, workspaceId, expectedRepoPath);
          requireNoRemoval(workspace);
          config.workspaces[workspaceId] = { ...workspace, closed: false };
          config.activeWorkspace = workspaceId;
          touchRecentWorkspace(config, workspaceId);
        });
        return yield* getWorkspaceCatalog();
      });
    },
    removeWorkspaceRegistration(workspaceId, expectedRepoPath) {
      return Effect.gen(function* () {
        yield* edit(workspaceId, (config, catalog) => {
          requireWorkspace(config, workspaceId, expectedRepoPath);
          delete config.workspaces[workspaceId];
          config.workspaceOrder = config.workspaceOrder.filter((id) => id !== workspaceId);
          config.recentWorkspaces = config.recentWorkspaces.filter((id) => id !== workspaceId);
          moveActiveSelection(config, workspaceId, catalog);
        });
        return yield* getWorkspaceCatalog();
      });
    },
    resolveWorkspacePath(rawRepoPath) {
      return Effect.gen(function* () {
        const canonical = yield* settingsConfig.canonicalizePath(rawRepoPath);
        const snapshot = yield* settingsConfig.readWorkspaceCatalogSnapshot();
        const matches = snapshot.workspaces.filter((workspace) => workspace.repoPath === canonical);
        if (matches.length > 1)
          return yield* new HostValidationError({
            field: "repoPath",
            message:
              "Several workspaces use this repository path. Select the workspace by its identity and retry.",
          });
        const workspace = matches[0];
        if (!workspace) return { kind: "new" as const } satisfies WorkspacePathResolution;
        return yield* Effect.try({
          try: () => workspacePathResolution(settingsConfig, snapshot, workspace),
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
        const saved = yield* edit(input.workspaceId, (config, catalog) => {
          const workspace = requireWorkspace(config, input.workspaceId, input.expectedRepoPath);
          if (workspace.removal) {
            if (
              workspace.removal.removeTaskWorktrees &&
              !input.removeTaskWorktrees &&
              workspace.removal.phase === "worktrees" &&
              workspace.removal.pendingWorktreePath === null
            ) {
              config.workspaces[input.workspaceId] = {
                ...workspace,
                removal: {
                  removeTaskWorktrees: false,
                  phase: "attachments",
                  pendingWorktreePath: null,
                },
              };
            }
            return;
          }
          const removal: WorkspaceRemovalRecord = {
            removeTaskWorktrees: input.removeTaskWorktrees,
            phase: input.removeTaskWorktrees ? "worktrees" : "attachments",
            pendingWorktreePath: null,
          };
          config.workspaces[input.workspaceId] = { ...workspace, removal };
          moveActiveSelection(config, input.workspaceId, catalog);
        });
        const removal = saved.workspaces[input.workspaceId]?.removal;
        if (!removal)
          return yield* new HostValidationError({
            field: "workspaceId",
            message: `Workspace ${input.workspaceId} no longer has a pending removal. Reload workspaces.`,
          });
        return removal;
      });
    },
    recordWorkspaceRemovalProgress(input) {
      return edit(input.workspaceId, (config) => {
        const workspace = requireWorkspace(config, input.workspaceId);
        if (!workspace.removal)
          throw new HostValidationError({
            message: `Workspace removal is not in progress for ${input.workspaceId}.`,
            field: "workspaceId",
          });
        config.workspaces[input.workspaceId] = {
          ...workspace,
          removal: {
            ...workspace.removal,
            phase: input.phase,
            pendingWorktreePath: input.pendingWorktreePath,
          },
        };
      }).pipe(Effect.asVoid);
    },
  };
};

const requireWorkspace = (
  config: GlobalConfig,
  workspaceId: string,
  expectedRepoPath?: string,
): RepoConfig => {
  const workspace = requireConfiguredWorkspace(config, workspaceId);
  if (expectedRepoPath !== undefined && workspace.repoPath !== expectedRepoPath)
    throw new HostValidationError({
      field: "repoPath",
      message: `Workspace ${workspaceId} changed since the dialog opened. Reload workspaces and retry.`,
      details: { expectedRepoPath, actualRepoPath: workspace.repoPath },
    });
  return workspace;
};

const requireNoRemoval = (workspace: RepoConfig): void => {
  if (workspace.removal)
    throw new HostValidationError({
      message: `Workspace removal is incomplete for ${workspace.workspaceId}. Retry removal from the workspace rail before using it.`,
      field: "workspaceId",
    });
};

const moveActiveSelection = (
  config: GlobalConfig,
  workspaceId: string,
  catalog: readonly WorkspaceCatalogRepo[],
): void => {
  if (config.activeWorkspace !== workspaceId) return;
  const next = firstOpenWorkspaceId(
    {
      ...config,
      workspaces: {
        ...Object.fromEntries(catalog.map((workspace) => [workspace.workspaceId, workspace])),
        ...config.workspaces,
      },
    },
    workspaceId,
  );
  if (next === undefined) delete config.activeWorkspace;
  else config.activeWorkspace = next;
};

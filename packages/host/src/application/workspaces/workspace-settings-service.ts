import { applySettingsEdits } from "./settings-edits";
import {
  agentModelFavoritesSchema,
  jsonValuesEqual,
  repoConfigSchema,
  type SettingsSnapshotSaveInput,
  settingsSnapshotSaveInputSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { parseConfig } from "../../config/parse-config";
import { applyTaskWorkflowSettings } from "../../config/workflow-settings";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import { HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { applyAgentStudioStateAction } from "./workspace-agent-studio-state";
import { createCustomAgentRoleOperations } from "./custom-agent-role-operations";
import { buildWorkspaceCatalog, workspaceRecordsInEffectiveOrder } from "./workspace-catalog-model";
import { createHostIdentitySettingsMethods } from "./host-identity-settings";
import { createWorkspaceLifecycleSettingsMethods } from "./workspace-lifecycle-settings";
import { withSerializedConfigWrites } from "./workspace-settings-serializer";
import {
  ensureRepoPathAvailable,
  type PreparedSettingsSnapshot,
  type SettingsWriteResult,
  requireConfiguredWorkspace,
  saveAndReturnWorkspaceRecord,
  toSettingsSnapshot,
  touchRecentWorkspace,
  validateAndNormalizeRepoConfig,
  validateGitRepoPath,
  type WorkspaceSettingsError,
  type WorkspaceSettingsService,
} from "./workspace-settings-model";

export type { WorkspaceSettingsError, WorkspaceSettingsService } from "./workspace-settings-model";

export const createWorkspaceSettingsService = (
  settingsConfig: SettingsConfigPort,
  taskWorkflows: TaskWorkflowResolver,
): WorkspaceSettingsService =>
  withSerializedConfigWrites(createSettingsService(settingsConfig, taskWorkflows));

const createSettingsService = (
  settingsConfig: SettingsConfigPort,
  taskWorkflows: TaskWorkflowResolver,
): WorkspaceSettingsService => ({
  ...createCustomAgentRoleOperations(settingsConfig),
  ...createWorkspaceLifecycleSettingsMethods(settingsConfig),
  ...createHostIdentitySettingsMethods(settingsConfig),
  listWorkspaces() {
    return Effect.gen(function* () {
      const snapshot = yield* settingsConfig.readWorkspaceCatalogSnapshot();
      return yield* Effect.try({
        try: () => buildWorkspaceCatalog(settingsConfig, snapshot).openWorkspaces,
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    });
  },
  addWorkspace(input) {
    return Effect.gen(function* () {
      const repoConfig = yield* validateAndNormalizeRepoConfig(settingsConfig, input);
      return yield* saveAndReturnWorkspaceRecord(
        settingsConfig,
        (current, catalog) => {
          if (current.workspaces[input.workspaceId])
            throw new HostValidationError({
              field: "workspaceId",
              message: `Workspace already exists in config: ${input.workspaceId}`,
            });
          ensureRepoPathAvailable(
            {
              workspaces: Object.fromEntries(
                catalog.map((workspace) => [workspace.workspaceId, workspace]),
              ),
            },
            repoConfig.repoPath,
          );
          current.workspaces[input.workspaceId] = repoConfig;
          current.workspaceOrder = [...current.workspaceOrder, input.workspaceId];
          current.activeWorkspace = input.workspaceId;
          touchRecentWorkspace(current, input.workspaceId);
          return current;
        },
        input.workspaceId,
        input.onRegistered,
      );
    });
  },
  selectWorkspace(workspaceId) {
    return Effect.gen(function* () {
      const snapshot = yield* settingsConfig.readWorkspaceCatalogSnapshot();
      const catalog = buildWorkspaceCatalog(settingsConfig, snapshot);
      const selected = catalog.openWorkspaces.find(
        (workspace) => workspace.workspaceId === workspaceId,
      );
      if (!selected) {
        const workspace = snapshot.workspaces.find((entry) => entry.workspaceId === workspaceId);
        let message = `Workspace not found in config: ${workspaceId}. Add/select the workspace before updating configuration.`;
        if (workspace?.closed)
          message = `Workspace is closed: ${workspaceId}. Reopen it before selecting it.`;
        else if (workspace?.removal)
          message = `Workspace removal is incomplete for ${workspaceId}. Retry removal from the workspace rail before using it.`;
        return yield* new HostValidationError({ field: "workspaceId", message });
      }
      yield* settingsConfig.updatePreferences((current) => {
        const next = { ...current, activeWorkspace: workspaceId };
        touchRecentWorkspace(next, workspaceId);
        return next;
      });
      return { ...selected, isActive: true };
    });
  },
  reorderWorkspaces(workspaceOrder) {
    return Effect.gen(function* () {
      const snapshot = yield* settingsConfig.readWorkspaceCatalogSnapshot();
      const catalog = buildWorkspaceCatalog(settingsConfig, snapshot);
      const open = new Set(catalog.openWorkspaces.map(({ workspaceId }) => workspaceId));
      if (workspaceOrder.length !== open.size)
        return yield* new HostValidationError({
          field: "workspaceOrder",
          message: `Workspace reorder must include exactly ${open.size} open workspaces.`,
        });
      const seen = new Set<string>();
      for (const id of workspaceOrder) {
        if (!open.has(id))
          return yield* new HostValidationError({
            field: "workspaceOrder",
            message: `Workspace reorder included unknown or closed workspace id: ${id}`,
          });
        if (seen.has(id))
          return yield* new HostValidationError({
            field: "workspaceOrder",
            message: `Workspace reorder included duplicate workspace id: ${id}`,
          });
        seen.add(id);
      }
      const workspaces = Object.fromEntries(
        snapshot.workspaces.map((workspace) => [workspace.workspaceId, workspace]),
      );
      const preferences = yield* settingsConfig.updatePreferences((current) => {
        let index = 0;
        return {
          ...current,
          workspaceOrder: workspaceRecordsInEffectiveOrder(settingsConfig, {
            ...current,
            workspaces,
          }).map((workspace) =>
            open.has(workspace.workspaceId) ? workspaceOrder[index++]! : workspace.workspaceId,
          ),
        };
      });
      return buildWorkspaceCatalog(settingsConfig, { ...snapshot, ...preferences }).openWorkspaces;
    });
  },
  getRepoConfig(workspaceId) {
    return Effect.gen(function* () {
      const repoConfig = yield* settingsConfig.readRepoConfig(workspaceId);
      if (!repoConfig) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace is not configured: ${workspaceId}`,
            field: "workspaceId",
          }),
        );
      }

      return yield* parseConfig(repoConfigSchema, repoConfig);
    });
  },
  getRepoConfigByRepoPath(rawRepoPath) {
    return Effect.gen(function* () {
      const repoPath = yield* settingsConfig.canonicalizePath(rawRepoPath);
      const repoConfig = yield* settingsConfig.readRepoConfigByRepoPath(repoPath);
      if (repoConfig === null)
        return yield* new HostValidationError({
          message: `Workspace is not configured for repository: ${repoPath}`,
          field: "repoPath",
        });
      return yield* parseConfig(repoConfigSchema, repoConfig);
    });
  },
  replaceAgentStudioState(workspaceId, rawState) {
    return settingsConfig.updateWorkspacePreferences(workspaceId, () => rawState);
  },
  applyAgentStudioStateAction(workspaceId, action) {
    return settingsConfig.updateWorkspacePreferences(workspaceId, (current) =>
      applyAgentStudioStateAction(current.agentStudioState, action),
    );
  },
  updateRepoGitConfig(workspaceId, git) {
    return saveAndReturnWorkspaceRecord(
      settingsConfig,
      (current) => {
        current.workspaces[workspaceId] = repoConfigSchema.parse({
          ...requireConfiguredWorkspace(current, workspaceId),
          git,
        });
        current.activeWorkspace ??= workspaceId;
        touchRecentWorkspace(current, workspaceId);
        return current;
      },
      workspaceId,
    );
  },
  getSettingsSnapshot() {
    return Effect.gen(function* () {
      const config = yield* settingsConfig.readConfig();
      return yield* Effect.try({
        try: () => toSettingsSnapshot(config),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    });
  },
  saveSettingsSnapshotWith(prepared, commit) {
    return saveSettingsSnapshotWith(settingsConfig, taskWorkflows, prepared, commit);
  },
  prepareSettingsSnapshot(rawSnapshot) {
    return prepareSettingsSnapshot(settingsConfig, taskWorkflows, rawSnapshot);
  },
  updateAgentModelFavorites(rawFavorites) {
    return Effect.gen(function* () {
      const favorites = yield* parseConfig(agentModelFavoritesSchema, rawFavorites);
      return yield* settingsConfig
        .updatePreferences((current) => ({
          ...current,
          agentModelFavorites: favorites,
        }))
        .pipe(Effect.map((saved) => saved.agentModelFavorites));
    });
  },
  updateKanbanTaskCardView(taskCardView) {
    return settingsConfig
      .updatePreferences((current) => ({
        ...current,
        kanban: { ...current.kanban, taskCardView },
      }))
      .pipe(Effect.map((saved) => saved.kanban.taskCardView));
  },
  updateSidebarSessionGrouping(sidebarSessionGrouping) {
    return settingsConfig
      .updatePreferences((current) => ({
        ...current,
        appearance: { ...current.appearance, sidebarSessionGrouping },
      }))
      .pipe(Effect.map((saved) => saved.appearance.sidebarSessionGrouping));
  },
  setTheme(theme) {
    return settingsConfig
      .updatePreferences((current) => ({ ...current, theme }))
      .pipe(Effect.asVoid);
  },
});

const prepareSettingsSnapshot = (
  settingsConfig: SettingsConfigPort,
  taskWorkflows: TaskWorkflowResolver,
  rawSnapshot: SettingsSnapshotSaveInput,
): Effect.Effect<PreparedSettingsSnapshot, WorkspaceSettingsError> =>
  Effect.gen(function* () {
    const edits = yield* parseConfig(settingsSnapshotSaveInputSchema, rawSnapshot);
    const current = yield* settingsConfig.readConfig(Object.keys(edits.workspaces ?? {}));
    const catalog = Object.values(edits.workspaces ?? {}).some(
      (patch) => patch.repoPath !== undefined && patch.repoPath !== patch.expectedRepoPath,
    )
      ? (yield* settingsConfig.readWorkspaceCatalogSnapshot()).workspaces
      : Object.values(current.workspaces);
    for (const [id, patch] of Object.entries(edits.workspaces ?? {})) {
      if (patch.repoPath !== undefined && patch.repoPath !== patch.expectedRepoPath) {
        const repoPath = yield* validateGitRepoPath(settingsConfig, patch.repoPath);
        edits.workspaces![id] = { ...patch, repoPath };
      }
    }
    const next = yield* Effect.try({
      try: () =>
        applyTaskWorkflowSettings(applySettingsEdits(current, edits, catalog), taskWorkflows),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    return { current, next, edits };
  });

const saveSettingsSnapshotWith = <A, E>(
  settingsConfig: SettingsConfigPort,
  taskWorkflows: TaskWorkflowResolver,
  prepared: PreparedSettingsSnapshot,
  commit: (
    write: Effect.Effect<SettingsWriteResult, WorkspaceSettingsError>,
  ) => Effect.Effect<A, E>,
): Effect.Effect<A, E | WorkspaceSettingsError> => {
  const { edits } = prepared;
  return commit(
    Effect.gen(function* () {
      // Rebase the prepared edits on the current rows inside the write transaction.
      const persistence = yield* settingsConfig.applyConfigChange(
        (current, catalog) => {
          for (const kind of Object.keys(edits.global?.agentRuntimes ?? {})) {
            if (!jsonValuesEqual(current.agentRuntimes[kind], prepared.current.agentRuntimes[kind]))
              throw new HostValidationError({
                field: "agentRuntimes",
                message: `Runtime ${kind} settings changed during review. Preview and save settings again.`,
              });
          }
          return applyTaskWorkflowSettings(
            applySettingsEdits(current, edits, catalog),
            taskWorkflows,
          );
        },
        Object.keys(edits.workspaces ?? {}),
      );
      return {
        shared: persistence.shared,
        preferences: persistence.preferences,
        workspaces: buildWorkspaceCatalog(
          settingsConfig,
          yield* settingsConfig.readWorkspaceCatalogSnapshot(persistence.config),
        ).openWorkspaces,
      };
    }),
  );
};

import { createHash } from "node:crypto";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { globalConfigSchema, jsonValuesEqual, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type HostPreferences,
  hostPreferencesSchema,
  composeGlobalConfig,
  toHostPreferences,
} from "../../config/global-config";
import { resolveUserPath } from "../../config/openducktor-config-dir";
import { parseConfig } from "../../config/parse-config";
import { readHostPreferences, writePreferences } from "./settings-config-file";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
  toHostPathStatError,
  errorMessage,
} from "../../effect/host-errors";
import { createSerialLane } from "../../effect/serial-gate";
import type { SharedSettingsDatabase, SettingsConfigPort } from "../../ports/settings-config-port";

const globalSettingsSchema = globalConfigSchema.omit({ workspaces: true });
const preferenceKeys = hostPreferencesSchema.keyof().options;

export type CreateSettingsConfigAdapterInput = {
  configPath: string;
  sharedSettings: SharedSettingsDatabase;
};

export const createSettingsConfigAdapter = ({
  configPath,
  sharedSettings,
}: CreateSettingsConfigAdapterInput): SettingsConfigPort => {
  const baseDir = path.dirname(configPath);
  const serialize = createSerialLane().run;
  const readPreferences = () => readHostPreferences(configPath);
  const withRepoPreferences = (read: ReturnType<SharedSettingsDatabase["readRepoConfig"]>) =>
    Effect.gen(function* () {
      const repo = yield* read;
      if (repo === null) return null;
      const preferences = yield* readPreferences();
      return yield* parseConfig(repoConfigSchema, {
        ...repo,
        ...preferences.workspaceUi[repo.workspaceId],
      });
    });
  const applyConfigChange: SettingsConfigPort["applyConfigChange"] = (change, workspaceIds) =>
    serialize(
      Effect.gen(function* () {
        const preferences = yield* readPreferences();
        const result = yield* sharedSettings.updateConfig(
          (current, catalog) =>
            globalConfigSchema.parse(change(composeGlobalConfig(current, preferences), catalog)),
          workspaceIds,
        );
        const shared = result.changed ? ("saved" as const) : ("unchanged" as const);
        const edit = preferenceEdit(
          preferences,
          toHostPreferences(result.next),
          workspaceIds ?? Object.keys(preferences.workspaceUi),
        );
        if (edit === null)
          return { shared, preferences: "unchanged" as const, config: result.next };
        // The transaction can wait for another host. Read the file again so that this change
        // writes only the preferences that it changed and keeps the edits of the other host.
        const persisted = yield* Effect.result(
          Effect.gen(function* () {
            const latest = yield* readPreferences();
            const next = edit(latest);
            if (jsonValuesEqual(latest, next))
              return { preferences: "unchanged" as const, saved: latest };
            yield* writePreferences(configPath, next);
            return { preferences: "saved" as const, saved: next };
          }),
        );
        if (persisted._tag === "Failure") {
          if (!result.changed) return yield* Effect.fail(persisted.failure);
          return {
            shared: "saved" as const,
            preferences: { message: persisted.failure.message },
            config: composeGlobalConfig(result.next, preferences),
          };
        }
        return {
          shared,
          preferences: persisted.success.preferences,
          config: composeGlobalConfig(result.next, persisted.success.saved),
        };
      }),
    );
  const savePreferences = (previous: HostPreferences, next: HostPreferences) =>
    jsonValuesEqual(previous, next)
      ? Effect.succeed(next)
      : writePreferences(configPath, next).pipe(Effect.as(next));
  return {
    readGlobalConfig() {
      return Effect.gen(function* () {
        const shared = yield* sharedSettings.readGlobalConfig();
        const {
          version: _version,
          workspaceUi: _workspaceUi,
          ...preferences
        } = yield* readPreferences();
        return yield* parseConfig(globalSettingsSchema, { ...shared, ...preferences });
      });
    },
    readAutopilotSettings: () => sharedSettings.readAutopilotSettings(),
    readRepoConfig: (workspaceId) =>
      withRepoPreferences(sharedSettings.readRepoConfig(workspaceId)),
    readRepoConfigByRepoPath: (repoPath) =>
      withRepoPreferences(sharedSettings.readRepoConfigByRepoPath(repoPath)),
    readWorkspaceCatalogSnapshot(savedPreferences) {
      return Effect.gen(function* () {
        const snapshot = yield* sharedSettings.readWorkspaceCatalogSnapshot();
        const { workspaceOrder, activeWorkspace } = savedPreferences ?? (yield* readPreferences());
        return { ...snapshot, workspaceOrder, activeWorkspace };
      });
    },
    readConfig(workspaceIds) {
      return Effect.gen(function* () {
        const shared = yield* sharedSettings.readConfig(workspaceIds);
        return composeGlobalConfig(shared, yield* readPreferences());
      });
    },
    applyConfigChange,
    updateConfig: (change, workspaceIds) =>
      applyConfigChange(change, workspaceIds).pipe(
        Effect.flatMap((result) =>
          result.preferences !== "saved" && result.preferences !== "unchanged"
            ? Effect.fail(
                new HostOperationError({
                  operation: "settingsConfig.updateConfig",
                  message: `Shared settings saved, but preferences could not be saved. Reload to confirm the saved settings before retrying. ${result.preferences.message}`,
                }),
              )
            : Effect.succeed(result.config),
        ),
      ),
    updatePreferences: (change) =>
      serialize(
        Effect.gen(function* () {
          const current = yield* readPreferences();
          const next = yield* Effect.try({
            try: () => hostPreferencesSchema.parse(change(structuredClone(current))),
            catch: (cause) =>
              cause instanceof HostValidationError
                ? cause
                : new HostValidationError({ message: errorMessage(cause), cause }),
          });
          return yield* savePreferences(current, next);
        }),
      ),
    updateWorkspacePreferences: (workspaceId, change) =>
      serialize(
        Effect.gen(function* () {
          const shared = yield* sharedSettings.readRepoConfig(workspaceId);
          if (shared === null)
            return yield* new HostValidationError({
              field: "workspaceId",
              message: `Workspace not found in config: ${workspaceId}. Add/select the workspace before updating configuration.`,
            });
          const preferences = yield* readPreferences();
          const current = yield* parseConfig(repoConfigSchema, {
            ...shared,
            ...preferences.workspaceUi[workspaceId],
          });
          const next = yield* Effect.try({
            try: () => repoConfigSchema.parse({ ...current, agentStudioState: change(current) }),
            catch: (cause) =>
              cause instanceof HostValidationError
                ? cause
                : new HostValidationError({ message: errorMessage(cause), cause }),
          });
          yield* savePreferences(preferences, {
            ...preferences,
            workspaceUi: {
              ...preferences.workspaceUi,
              [workspaceId]: { agentStudioState: next.agentStudioState },
            },
          });
          return next;
        }),
      ),
    defaultWorktreeBasePath(workspaceId) {
      return path.join(baseDir, "worktrees", workspaceId.trim());
    },
    defaultRepoWorktreeBasePath(repoPath) {
      return path.join(baseDir, "worktrees", repoId(repoPath.trim()));
    },
    resolveConfiguredPath(rawPath) {
      return resolveUserPath(rawPath);
    },
    canonicalizePath(rawPath) {
      return Effect.tryPromise({
        try: () => realpath(rawPath),
        catch: (cause) =>
          toHostOperationError(cause, "settingsConfig.canonicalizePath", {
            path: rawPath,
          }),
      });
    },
    pathExists(inputPath) {
      return Effect.tryPromise({
        try: () => access(inputPath),
        catch: (cause) => toHostPathStatError(cause, "settingsConfig.pathExists", inputPath),
      }).pipe(
        Effect.as(true),
        Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
      );
    },
    join(...paths) {
      return path.join(...paths);
    },
  };
};

/**
 * Returns the edit that applies to the latest preferences only the preferences that differ
 * between `before` and `changed`, or null when none differ. `workspaceIds` names the workspaces
 * whose UI state the change can touch. `changed` holds no UI state for a workspace that the
 * change removed.
 */
const preferenceEdit = (
  before: HostPreferences,
  changed: HostPreferences,
  workspaceIds: readonly string[],
): ((latest: HostPreferences) => HostPreferences) | null => {
  const keys = preferenceKeys.filter(
    (key) => key !== "workspaceUi" && !jsonValuesEqual(before[key], changed[key]),
  );
  const workspaceUiIds = [
    ...new Set([...workspaceIds, ...Object.keys(changed.workspaceUi)]),
  ].filter((id) => !jsonValuesEqual(before.workspaceUi[id], changed.workspaceUi[id]));
  if (keys.length === 0 && workspaceUiIds.length === 0) return null;
  return (latest) => {
    const next: HostPreferences = { ...latest, workspaceUi: { ...latest.workspaceUi } };
    for (const key of keys) copyPreference(next, changed, key);
    for (const id of workspaceUiIds) {
      const value = changed.workspaceUi[id];
      if (value === undefined) delete next.workspaceUi[id];
      else next.workspaceUi[id] = value;
    }
    return next;
  };
};

const copyPreference = <Key extends keyof HostPreferences>(
  target: HostPreferences,
  source: HostPreferences,
  key: Key,
): void => {
  target[key] = source[key];
};

const sanitizeRepoSlug = (input: string): string => {
  let slug = "";
  let lastDash = false;

  for (const character of input) {
    const lower = character.toLowerCase();
    if (/^[a-z0-9]$/.test(lower)) {
      slug += lower;
      lastDash = false;
      continue;
    }

    if (!lastDash) {
      slug += "-";
      lastDash = true;
    }
  }

  const trimmed = slug.replace(/^-+|-+$/g, "");
  return trimmed.length > 0 ? trimmed : "repo";
};

const repoId = (repoPath: string): string => {
  const absolute = path.isAbsolute(repoPath) ? repoPath : path.resolve(repoPath);
  const slug = sanitizeRepoSlug(path.basename(absolute) || "repo");
  const hash = createHash("sha256").update(absolute).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
};

import {
  type GlobalConfig,
  type RepoConfig,
  globalConfigSchema,
  jsonValuesEqual,
} from "@openducktor/contracts";
import { eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";
import * as schema from "./sqlite-host-settings-schema";
import { writeAutopilotRules } from "./sqlite-host-settings-store-autopilot";
import { replaceRuntimeSettings } from "./sqlite-host-settings-store-policies";
import { writeRemoteAccessListener } from "./sqlite-host-settings-store-remote-access";
import {
  type HostSettingsChanges,
  type HostSettingsWriter,
  settingsGroupChanged,
  settingsKeyChanges,
  settingsRowBatches,
  settingsWriteOperation as operation,
  validateHostSettings,
} from "./sqlite-host-settings-store-validation";
import { saveWorkspace } from "./sqlite-host-settings-store-workspaces";
export { readHostSharedConfig } from "./sqlite-host-settings-store-reads";

const writeHostRow: HostSettingsWriter = (session, current, next) =>
  Effect.gen(function* () {
    const host = {
      singletonId: 1,
      hostId: next.hostId ?? crypto.randomUUID(),
      defaultMergeMethod: next.git.defaultMergeMethod,
      removeWorktreeOnClose: next.git.removeWorktreeOnClose,
      alwaysStartQaReviewsFresh: next.autopilot.alwaysStartQaReviewsFresh,
      remoteAccessEnabled: next.remoteAccess.enabled,
    };
    if (!current) {
      yield* session.execute((db) => db.insert(schema.hostSettings).values(host), operation);
      return settingsGroupChanged(true);
    }
    const hostFields = (config: GlobalConfig) => [
      config.hostId,
      config.git,
      config.autopilot.alwaysStartQaReviewsFresh,
      config.remoteAccess.enabled,
    ];
    if (jsonValuesEqual(hostFields(current), hostFields(next))) return settingsGroupChanged(false);
    yield* session.execute(
      (db) =>
        db.update(schema.hostSettings).set(host).where(eq(schema.hostSettings.singletonId, 1)),
      operation,
    );
    return settingsGroupChanged(true);
  });

const writeWorkspaces: HostSettingsWriter = (session, current, next) =>
  Effect.gen(function* () {
    const changes: HostSettingsChanges = { changed: false, membershipChanged: false };
    for (const workspaceId of Object.keys(current?.workspaces ?? {})) {
      if (next.workspaces[workspaceId]) continue;
      yield* session.execute(
        (db) => db.delete(schema.workspaces).where(eq(schema.workspaces.workspaceId, workspaceId)),
        operation,
      );
      changes.changed = true;
      changes.membershipChanged = true;
    }
    for (const [workspaceId, workspace] of Object.entries(next.workspaces)) {
      const previous = current?.workspaces[workspaceId];
      if (jsonValuesEqual(previous && sharedWorkspace(previous), sharedWorkspace(workspace)))
        continue;
      yield* saveWorkspace(session, workspace, previous);
      if (!previous || previous.repoPath !== workspace.repoPath) changes.membershipChanged = true;
      changes.changed = true;
    }
    return changes;
  });

const writeCustomRoles: HostSettingsWriter = (session, current, next) =>
  Effect.gen(function* () {
    if (jsonValuesEqual(current?.customAgentRoles, next.customAgentRoles))
      return settingsGroupChanged(false);
    yield* session.execute((db) => db.delete(schema.customAgentRoles), operation);
    const roles = next.customAgentRoles.map((role, position) => ({
      roleId: role.id,
      position,
      name: role.name,
      nameKey: role.name.toLowerCase(),
      systemPrompt: role.systemPrompt,
    }));
    for (const rows of settingsRowBatches(roles))
      yield* session.execute((db) => db.insert(schema.customAgentRoles).values(rows), operation);
    return settingsGroupChanged(true);
  });

const writeGlobalPrompts: HostSettingsWriter = (session, current, next) =>
  Effect.gen(function* () {
    const prompts = settingsKeyChanges(current?.globalPromptOverrides, next.globalPromptOverrides);
    for (const keys of settingsRowBatches(prompts.removed))
      yield* session.execute(
        (db) =>
          db
            .delete(schema.globalPromptOverrides)
            .where(inArray(schema.globalPromptOverrides.templateId, keys)),
        operation,
      );
    for (const rows of settingsRowBatches(
      prompts.changed.map(([templateId, prompt]) => ({
        templateId,
        ...prompt,
        enabled: prompt.enabled ?? null,
      })),
    ))
      yield* session.execute(
        (db) =>
          db
            .insert(schema.globalPromptOverrides)
            .values(rows)
            .onConflictDoUpdate({
              target: schema.globalPromptOverrides.templateId,
              set: {
                template: sql`excluded.template`,
                baseVersion: sql`excluded.base_version`,
                enabled: sql`excluded.enabled`,
              },
            }),
        operation,
      );
    return settingsGroupChanged(prompts.removed.length > 0 || prompts.changed.length > 0);
  });

const writeRuntimes: HostSettingsWriter = (session, current, next) =>
  Effect.gen(function* () {
    let changed = false;
    for (const kind of new Set([
      ...Object.keys(current?.agentRuntimes ?? {}),
      ...Object.keys(next.agentRuntimes),
    ]))
      if (!jsonValuesEqual(current?.agentRuntimes[kind], next.agentRuntimes[kind])) {
        yield* replaceRuntimeSettings(session, kind, next.agentRuntimes[kind]);
        changed = true;
      }
    return settingsGroupChanged(changed);
  });

const writers: readonly HostSettingsWriter[] = [
  writeHostRow,
  writeWorkspaces,
  writeCustomRoles,
  writeGlobalPrompts,
  writeRuntimes,
  writeAutopilotRules,
  writeRemoteAccessListener,
];

/** The caller supplies current values read under the same write transaction. */
export const applyHostSharedConfigEdits = (
  session: HostDatabaseSession,
  current: GlobalConfig | null,
  nextInput: GlobalConfig,
) =>
  Effect.gen(function* () {
    const next = yield* validateHostSettings(
      () => globalConfigSchema.parse(nextInput),
      "settings write",
    );
    const changes: HostSettingsChanges = { changed: false, membershipChanged: false };
    for (const write of writers) {
      const group = yield* write(session, current, next);
      changes.changed ||= group.changed;
      changes.membershipChanged ||= group.membershipChanged;
    }
    return changes;
  });

export const importHostSharedConfig = (session: HostDatabaseSession, legacy: GlobalConfig) =>
  applyHostSharedConfigEdits(session, null, legacy).pipe(Effect.asVoid);

const sharedWorkspace = ({ agentStudioState: _ui, closed, ...value }: RepoConfig) => ({
  ...value,
  closed: closed ?? false,
});

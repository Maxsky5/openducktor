import { jsonValuesEqual, type RepoConfig } from "@openducktor/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import { canonicalGitlabInstanceUrl } from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";
import * as schema from "./sqlite-host-settings-schema";
import { settingsKeyChanges, settingsRowBatches } from "./sqlite-host-settings-store-validation";
import {
  promptKeyColumns,
  promptKeysMatch,
  writePromptLayerRows,
} from "./sqlite-prompt-layer-rows";

const operation = "hostSettings.workspace";
export const saveWorkspace = (
  session: HostDatabaseSession,
  config: RepoConfig,
  previous: RepoConfig | undefined,
) =>
  Effect.gen(function* () {
    const workspaceId = config.workspaceId;
    const actionsChanged = !jsonValuesEqual(previous?.actions.items, config.actions.items);
    const values = workspaceValues(config);
    if (actionsChanged) values.defaultActionId = null;
    if (!previous)
      yield* session.execute((db) => db.insert(schema.workspaces).values(values), operation);
    else if (!jsonValuesEqual(workspaceValues(previous), values))
      yield* session.execute(
        (db) =>
          db
            .update(schema.workspaces)
            .set(values)
            .where(eq(schema.workspaces.workspaceId, workspaceId)),
        operation,
      );
    const defaultModel = config.defaultModel;
    if (!jsonValuesEqual(previous?.defaultModel, defaultModel)) {
      if (previous?.defaultModel)
        yield* session.execute(
          (db) =>
            db
              .delete(schema.workspaceDefaultModels)
              .where(eq(schema.workspaceDefaultModels.workspaceId, workspaceId)),
          operation,
        );
      if (defaultModel)
        yield* session.execute(
          (db) => db.insert(schema.workspaceDefaultModels).values({ workspaceId, ...defaultModel }),
          operation,
        );
    }
    const models = settingsKeyChanges(previous?.agentDefaults, config.agentDefaults);
    for (const keys of settingsRowBatches(models.removed))
      yield* session.execute(
        (db) =>
          db
            .delete(schema.workspaceRoleDefaults)
            .where(
              and(
                eq(schema.workspaceRoleDefaults.workspaceId, workspaceId),
                inArray(schema.workspaceRoleDefaults.roleId, keys),
              ),
            ),
        operation,
      );
    for (const rows of settingsRowBatches(
      models.changed.map(([roleId, model]) => ({
        workspaceId,
        roleId,
        ...model,
        variant: model.variant ?? null,
        profileId: model.profileId ?? null,
      })),
    ))
      yield* session.execute(
        (db) =>
          db
            .insert(schema.workspaceRoleDefaults)
            .values(rows)
            .onConflictDoUpdate({
              target: [
                schema.workspaceRoleDefaults.workspaceId,
                schema.workspaceRoleDefaults.roleId,
              ],
              set: {
                runtimeKind: sql`excluded.runtime_kind`,
                providerId: sql`excluded.provider_id`,
                modelId: sql`excluded.model_id`,
                variant: sql`excluded.variant`,
                profileId: sql`excluded.profile_id`,
              },
            }),
        operation,
      );
    if (
      !jsonValuesEqual(previous?.hooks.beforeWorktreeRemoval, config.hooks.beforeWorktreeRemoval)
    ) {
      if (previous)
        yield* session.execute(
          (db) =>
            db
              .delete(schema.workspaceBeforeWorktreeRemovalCommands)
              .where(eq(schema.workspaceBeforeWorktreeRemovalCommands.workspaceId, workspaceId)),
          operation,
        );
      const commands = config.hooks.beforeWorktreeRemoval.map((command, position) => ({
        workspaceId,
        position,
        command,
      }));
      for (const rows of settingsRowBatches(commands))
        yield* session.execute(
          (db) => db.insert(schema.workspaceBeforeWorktreeRemovalCommands).values(rows),
          operation,
        );
    }
    if (actionsChanged) {
      if (previous)
        yield* session.execute(
          (db) =>
            db
              .delete(schema.workspaceActions)
              .where(eq(schema.workspaceActions.workspaceId, workspaceId)),
          operation,
        );
      const actions = config.actions.items.map(({ id: actionId, ...action }, position) => ({
        workspaceId,
        actionId,
        position,
        ...action,
      }));
      for (const rows of settingsRowBatches(actions))
        yield* session.execute((db) => db.insert(schema.workspaceActions).values(rows), operation);
      if (config.actions.defaultActionId !== null)
        yield* session.execute(
          (db) =>
            db
              .update(schema.workspaces)
              .set({ defaultActionId: config.actions.defaultActionId })
              .where(eq(schema.workspaces.workspaceId, workspaceId)),
          operation,
        );
    }
    if (!jsonValuesEqual(previous?.worktreeCopyPaths, config.worktreeCopyPaths)) {
      if (previous)
        yield* session.execute(
          (db) =>
            db
              .delete(schema.workspaceCopyPaths)
              .where(eq(schema.workspaceCopyPaths.workspaceId, workspaceId)),
          operation,
        );
      const paths = config.worktreeCopyPaths.map((path, position) => ({
        workspaceId,
        position,
        path,
      }));
      for (const rows of settingsRowBatches(paths))
        yield* session.execute(
          (db) => db.insert(schema.workspaceCopyPaths).values(rows),
          operation,
        );
    }
    yield* writePromptLayerRows(
      session,
      operation,
      previous?.promptOverrides,
      config.promptOverrides,
      {
        remove: (keys) => (db) =>
          db
            .delete(schema.workspacePromptOverrides)
            .where(
              and(
                eq(schema.workspacePromptOverrides.workspaceId, workspaceId),
                promptKeysMatch(schema.workspacePromptOverrides, keys),
              ),
            ),
        row: (key, prompt) => ({
          workspaceId,
          ...promptKeyColumns(key),
          ...prompt,
          enabled: prompt.enabled ?? null,
        }),
        upsert: (rows) => (db) =>
          db
            .insert(schema.workspacePromptOverrides)
            .values(rows)
            .onConflictDoUpdate({
              target: [
                schema.workspacePromptOverrides.workspaceId,
                schema.workspacePromptOverrides.ownerKind,
                schema.workspacePromptOverrides.ownerId,
                schema.workspacePromptOverrides.promptId,
              ],
              set: {
                template: sql`excluded.template`,
                baseVersion: sql`excluded.base_version`,
                enabled: sql`excluded.enabled`,
              },
            }),
      },
    );
    yield* writePromptLayerRows(session, operation, previous?.promptAppends, config.promptAppends, {
      remove: (keys) => (db) =>
        db
          .delete(schema.workspacePromptAppends)
          .where(
            and(
              eq(schema.workspacePromptAppends.workspaceId, workspaceId),
              promptKeysMatch(schema.workspacePromptAppends, keys),
            ),
          ),
      row: (key, append) => ({ workspaceId, ...promptKeyColumns(key), ...append }),
      upsert: (rows) => (db) =>
        db
          .insert(schema.workspacePromptAppends)
          .values(rows)
          .onConflictDoUpdate({
            target: [
              schema.workspacePromptAppends.workspaceId,
              schema.workspacePromptAppends.ownerKind,
              schema.workspacePromptAppends.ownerId,
              schema.workspacePromptAppends.promptId,
            ],
            set: { text: sql`excluded.text`, enabled: sql`excluded.enabled` },
          }),
    });
    const removal = config.removal;
    if (!jsonValuesEqual(previous?.removal, removal)) {
      if (previous?.removal)
        yield* session.execute(
          (db) =>
            db
              .delete(schema.workspaceRemovals)
              .where(eq(schema.workspaceRemovals.workspaceId, workspaceId)),
          operation,
        );
      if (removal)
        yield* session.execute(
          (db) => db.insert(schema.workspaceRemovals).values({ workspaceId, ...removal }),
          operation,
        );
    }
    const provider = config.git.provider;
    if (jsonValuesEqual(previous?.git.provider, provider)) return;
    if (previous)
      yield* session.execute(
        (db) =>
          db
            .delete(schema.workspaceGitConfig)
            .where(eq(schema.workspaceGitConfig.workspaceId, workspaceId)),
        operation,
      );
    if (provider) {
      yield* session.execute(
        (db) =>
          db.insert(schema.workspaceGitConfig).values({
            workspaceId,
            providerId: provider.id,
            enabled: provider.enabled,
            autoDetected: provider.autoDetected,
          }),
        operation,
      );
      const repository = provider.repository;
      if (provider.id === "azure_devops") {
        const azure =
          repository && "providerId" in repository && repository.providerId === "azure_devops"
            ? repository
            : undefined;
        const settings = provider.settings;
        if (azure || settings?.httpConsentCollectionUrl || settings?.areaPath)
          yield* session.execute(
            (db) =>
              db.insert(schema.workspaceAzureConfig).values({
                workspaceId,
                providerId: "azure_devops",
                deployment: azure?.deployment ?? null,
                serviceUrl: azure?.serviceUrl ?? null,
                organization: azure?.organization ?? null,
                project: azure?.project ?? null,
                repositoryName: azure?.name ?? null,
                httpConsentCollectionUrl: settings?.httpConsentCollectionUrl ?? null,
                areaPath: settings?.areaPath ?? null,
                remoteMappingsJson: JSON.stringify(
                  (settings?.remoteMappings ?? []).map(({ remoteName, fetchUrl, pushUrls }) => ({
                    remoteName,
                    fetchUrl,
                    pushUrls,
                  })),
                ),
              }),
            operation,
          );
      } else if (provider.id === "gitlab") {
        const gitlab = repository && "providerId" in repository ? repository : undefined;
        const settings = provider.settings;
        if (gitlab?.providerId === "gitlab" && settings?.accountId)
          yield* requireGitlabAccountLink(session, settings.accountId, gitlab.instanceUrl);
        const values = {
          instanceUrl: gitlab?.providerId === "gitlab" ? gitlab.instanceUrl : null,
          projectPath: gitlab?.providerId === "gitlab" ? gitlab.projectPath : null,
          accountId: settings?.accountId ?? null,
          remoteName: settings?.remoteName ?? null,
          httpConsentInstanceUrl: settings?.httpConsentInstanceUrl ?? null,
        };
        if (Object.values(values).some((value) => value !== null))
          yield* session.execute(
            (db) =>
              db
                .insert(schema.workspaceGitlabConfig)
                .values({ workspaceId, providerId: "gitlab", ...values }),
            operation,
          );
      } else if (repository && !("providerId" in repository)) {
        yield* session.execute(
          (db) =>
            db.insert(schema.workspaceRepositoryIdentity).values({
              workspaceId,
              providerId: provider.id,
              host: repository.host,
              owner: repository.owner,
              name: repository.name,
            }),
          operation,
        );
      }
    }
  });

// A repository can link only a saved account on its own GitLab instance.
const requireGitlabAccountLink = (
  session: HostDatabaseSession,
  accountId: string,
  instanceUrl: string,
) =>
  Effect.gen(function* () {
    const [account] = yield* session.execute(
      (db) =>
        db
          .select({ instanceUrl: schema.gitlabAccounts.instanceUrl })
          .from(schema.gitlabAccounts)
          .where(eq(schema.gitlabAccounts.accountId, accountId)),
      operation,
    );
    if (!account)
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.settings.accountId",
          message:
            "The linked GitLab account is no longer saved. Connect the GitLab account again, then save.",
        }),
      );
    if (account.instanceUrl !== canonicalGitlabInstanceUrl(instanceUrl))
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.settings.accountId",
          message:
            "The linked GitLab account belongs to another GitLab instance. Choose an account on this instance, then save.",
        }),
      );
  });

const workspaceValues = (config: RepoConfig) => ({
  workspaceId: config.workspaceId,
  workspaceName: config.workspaceName,
  repoPath: config.repoPath,
  abbreviation: config.abbreviation ?? null,
  tileColor: config.tileColor ?? null,
  worktreeBasePath: config.worktreeBasePath ?? null,
  branchPrefix: config.branchPrefix,
  defaultTargetBranch: config.defaultTargetBranch.branch,
  defaultTargetRemote: config.defaultTargetBranch.remote ?? null,
  defaultActionId: config.actions.defaultActionId,
  closed: config.closed ?? false,
});

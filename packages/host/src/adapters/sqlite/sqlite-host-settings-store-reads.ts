import { sqliteValues } from "./sqlite-parameters";
import {
  type GitProviderRepository,
  type GitProviderConfig,
  azureDevOpsRepositorySchema,
  azureDevOpsProviderSettingsSchema,
  autopilotSettingsSchema,
  globalConfigSchema,
  repoConfigSchema,
  gitProviderConfigSchema,
  gitlabRepositorySchema,
} from "@openducktor/contracts";
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { SharedRepoConfig } from "../../ports/settings-config-port";
import type { SqliteDrizzleExecutor } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import type { HostDatabaseSession, hostDatabaseSchema } from "./sqlite-host-database-schema";
import * as schema from "./sqlite-host-settings-schema";
import { readRuntimePolicies } from "./sqlite-host-settings-store-policies";
import { validateHostSettings } from "./sqlite-host-settings-store-validation";

const operation = "hostSettings.read";
const sharedRepoSchema = repoConfigSchema.omit({ agentStudioState: true });
const globalSettingsSchema = globalConfigSchema.omit({ workspaces: true });
const mappingsSchema = z.array(
  z.strictObject({
    remoteName: z.string().min(1),
    fetchUrl: z.string().min(1),
    pushUrls: z.array(z.string().min(1)).min(1),
  }),
);
/** Startup imports the host settings before any read, so a missing row means a broken database. */
export const missingHostSettings = () =>
  new HostOperationError({
    operation,
    message:
      "Host database settings are not initialized. Restart the host and complete database migration.",
  });
const autopilotRules = sql<string>`(
  select json_group_array(json_object(
    'workflowId', workflow_id, 'eventId', event_id,
    'actionIds', json((select json_group_array(action_id) from (
      select action_id from autopilot_rule_actions
      where workflow_id = autopilot_rules.workflow_id and event_id = autopilot_rules.event_id
      order by position
    )))
  )) from autopilot_rules
)`.mapWith(JSON.parse);

export const readHostAutopilotSettings = (session: HostDatabaseSession) =>
  Effect.gen(function* () {
    const [host] = yield* session.execute(
      (db) =>
        db
          .select({
            alwaysStartQaReviewsFresh: schema.hostSettings.alwaysStartQaReviewsFresh,
            rules: autopilotRules,
          })
          .from(schema.hostSettings)
          .where(eq(schema.hostSettings.singletonId, 1)),
      operation,
    );
    if (!host) return yield* missingHostSettings();
    return yield* validateHostSettings(
      () => autopilotSettingsSchema.parse(host),
      "Autopilot settings",
    );
  });

export const readHostGlobalConfig = (session: HostDatabaseSession) =>
  Effect.gen(function* () {
    const [row] = yield* session.execute(
      (db) =>
        db
          .select({
            host: schema.hostSettings,
            listener: schema.remoteAccessListener,
            rules: autopilotRules,
            roles: sql<string>`(select json_group_array(json_object(
          'id', role_id, 'name', name, 'systemPrompt', system_prompt
        )) from (select role_id, name, system_prompt from custom_agent_roles order by position))`.mapWith(
              JSON.parse,
            ),
            prompts:
              sql<string>`(select json_group_object(json_array(owner_kind, owner_id, prompt_id), json_patch(
          json_object('template', template, 'baseVersion', base_version),
          json_object('enabled', json(case enabled when 1 then 'true' when 0 then 'false' else 'null' end))
        )) from global_prompt_overrides)`.mapWith(JSON.parse),
            origins: sql<string>`(select json_group_array(origin) from (
          select origin from remote_access_web_origins order by position
        ))`.mapWith(JSON.parse),
          })
          .from(schema.hostSettings)
          .leftJoin(
            schema.remoteAccessListener,
            eq(schema.remoteAccessListener.singletonId, schema.hostSettings.singletonId),
          )
          .where(eq(schema.hostSettings.singletonId, 1)),
      operation,
    );
    if (!row) return yield* missingHostSettings();
    const { host, listener } = row;
    const runtimes = yield* readRuntimePolicies(session);
    return yield* validateHostSettings(
      () =>
        globalSettingsSchema.parse({
          version: 4,
          hostId: host.hostId,
          git: {
            defaultMergeMethod: host.defaultMergeMethod,
            removeWorktreeOnClose: host.removeWorktreeOnClose,
          },
          agentRuntimes: runtimes,
          customAgentRoles: row.roles,
          globalPromptOverrides: row.prompts,
          autopilot: {
            alwaysStartQaReviewsFresh: host.alwaysStartQaReviewsFresh,
            rules: row.rules,
          },
          remoteAccess: {
            enabled: host.remoteAccessEnabled,
            configuration: listener
              ? {
                  listenHost: listener.listenHost,
                  listenPort: listener.listenPort,
                  publicEndpoint: listener.publicEndpoint ?? undefined,
                  webOrigins: listener.webOriginsPresent ? row.origins : undefined,
                }
              : null,
          },
        }),
      "global settings",
    );
  });

export const readHostRepoConfig = (session: HostDatabaseSession, workspaceId: string) =>
  Effect.gen(function* () {
    const [row] = yield* session.execute(
      (db) => workspaceQuery(db, eq(schema.workspaces.workspaceId, workspaceId)),
      operation,
    );
    return row ? yield* mapWorkspace(row) : null;
  });

export const readHostRepoConfigByRepoPath = (session: HostDatabaseSession, repoPath: string) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (db) => workspaceQuery(db, eq(schema.workspaces.repoPath, repoPath)).limit(2),
      operation,
    );
    if (rows.length > 1)
      return yield* new HostValidationError({
        message: `Repository path ${repoPath} matches multiple workspaces. Select a workspace by its ID.`,
      });
    return rows[0] ? yield* mapWorkspace(rows[0]) : null;
  });

export const readHostSharedConfig = (
  session: HostDatabaseSession,
  workspaceIds?: readonly string[],
) =>
  Effect.gen(function* () {
    const global = yield* readHostGlobalConfig(session);
    const rows =
      workspaceIds?.length === 0
        ? []
        : yield* session.execute(
            (db) =>
              workspaceQuery(
                db,
                workspaceIds === undefined
                  ? undefined
                  : inArray(schema.workspaces.workspaceId, sqliteValues(workspaceIds)),
              ),
            operation,
          );
    const workspaces: Record<string, SharedRepoConfig> = {};
    for (const row of rows) {
      const config = yield* mapWorkspace(row);
      workspaces[config.workspaceId] = config;
    }
    return yield* validateHostSettings(
      () => globalConfigSchema.parse({ ...global, workspaces }),
      "global settings",
    );
  });

const workspaceQuery = (db: SqliteDrizzleExecutor<typeof hostDatabaseSchema>, where?: SQL) =>
  db
    .select({
      workspace: schema.workspaces,
      model: schema.workspaceDefaultModels,
      provider: schema.workspaceGitConfig,
      githubConfig: schema.workspaceRepositoryIdentity,
      azureConfig: schema.workspaceAzureConfig,
      gitlabConfig: schema.workspaceGitlabConfig,
      removal: schema.workspaceRemovals,
      agentDefaults: sql<string>`(select json_group_object(role_id, json_object(
    'runtimeKind', runtime_kind, 'providerId', provider_id, 'modelId', model_id,
    'variant', variant, 'profileId', profile_id
  )) from workspace_role_defaults where workspace_id = ${schema.workspaces.workspaceId})`.mapWith(
        JSON.parse,
      ),
      commands: sql<string>`(select json_group_array(command) from (
    select command from workspace_before_worktree_removal_commands
    where workspace_id = ${schema.workspaces.workspaceId} order by position
  ))`.mapWith(JSON.parse),
      actions: sql<string>`(select json_group_array(json_object(
    'id', action_id, 'icon', icon, 'name', name, 'command', command,
    'runOnWorktreeCreate', json(case run_on_worktree_create when 1 then 'true' else 'false' end),
    'waitBeforeAgentStart', json(case wait_before_agent_start when 1 then 'true' else 'false' end)
  )) from (select action_id, icon, name, command, run_on_worktree_create, wait_before_agent_start
    from workspace_actions where workspace_id = ${schema.workspaces.workspaceId} order by position))`.mapWith(
        JSON.parse,
      ),
      paths: sql<string>`(select json_group_array(path) from (
    select path from workspace_copy_paths where workspace_id = ${schema.workspaces.workspaceId} order by position
  ))`.mapWith(JSON.parse),
      prompts:
        sql<string>`(select json_group_object(json_array(owner_kind, owner_id, prompt_id), json_patch(
    json_object('template', template, 'baseVersion', base_version),
    json_object('enabled', json(case enabled when 1 then 'true' when 0 then 'false' else 'null' end))
  )) from workspace_prompt_overrides where workspace_id = ${schema.workspaces.workspaceId})`.mapWith(
          JSON.parse,
        ),
    })
    .from(schema.workspaces)
    .leftJoin(
      schema.workspaceDefaultModels,
      eq(schema.workspaceDefaultModels.workspaceId, schema.workspaces.workspaceId),
    )
    .leftJoin(
      schema.workspaceGitConfig,
      eq(schema.workspaceGitConfig.workspaceId, schema.workspaces.workspaceId),
    )
    .leftJoin(
      schema.workspaceRepositoryIdentity,
      eq(schema.workspaceRepositoryIdentity.workspaceId, schema.workspaces.workspaceId),
    )
    .leftJoin(
      schema.workspaceAzureConfig,
      eq(schema.workspaceAzureConfig.workspaceId, schema.workspaces.workspaceId),
    )
    .leftJoin(
      schema.workspaceGitlabConfig,
      eq(schema.workspaceGitlabConfig.workspaceId, schema.workspaces.workspaceId),
    )
    .leftJoin(
      schema.workspaceRemovals,
      eq(schema.workspaceRemovals.workspaceId, schema.workspaces.workspaceId),
    )
    .where(where);

type WorkspaceRow = Awaited<ReturnType<typeof workspaceQuery>>[number];
const mapWorkspace = ({
  workspace: row,
  model,
  provider,
  githubConfig,
  azureConfig,
  gitlabConfig,
  removal,
  ...collections
}: WorkspaceRow) =>
  Effect.gen(function* () {
    const workspaceId = row.workspaceId;
    const git = yield* validateHostSettings(() => {
      if (!provider) return {};
      let repository: GitProviderRepository | undefined;
      let settings: GitProviderConfig["settings"];
      if (githubConfig)
        repository = {
          host: githubConfig.host,
          owner: githubConfig.owner,
          name: githubConfig.name,
        };
      if (azureConfig) {
        if (azureConfig.repositoryName !== null)
          repository = azureDevOpsRepositorySchema.parse({
            providerId: "azure_devops",
            deployment: azureConfig.deployment,
            serviceUrl: azureConfig.serviceUrl,
            organization: azureConfig.organization,
            project: azureConfig.project,
            name: azureConfig.repositoryName,
          });
        const mappings = mappingsSchema.parse(JSON.parse(azureConfig.remoteMappingsJson));
        const values = azureDevOpsProviderSettingsSchema.parse({
          httpConsentCollectionUrl: azureConfig.httpConsentCollectionUrl ?? undefined,
          areaPath: azureConfig.areaPath ?? undefined,
          remoteMappings: mappings.length
            ? mappings.map((mapping) => ({ ...mapping, repository }))
            : undefined,
        });
        if (
          azureConfig.httpConsentCollectionUrl !== null ||
          azureConfig.areaPath !== null ||
          mappings.length
        )
          settings = values;
      }
      if (gitlabConfig) {
        if (gitlabConfig.instanceUrl !== null && gitlabConfig.projectPath !== null)
          repository = gitlabRepositorySchema.parse({
            providerId: "gitlab",
            instanceUrl: gitlabConfig.instanceUrl,
            projectPath: gitlabConfig.projectPath,
          });
        const values = {
          accountId: gitlabConfig.accountId ?? undefined,
          remoteName: gitlabConfig.remoteName ?? undefined,
          httpConsentInstanceUrl: gitlabConfig.httpConsentInstanceUrl ?? undefined,
        };
        if (Object.values(values).some((value) => value !== undefined)) settings = values;
      }
      return {
        provider: gitProviderConfigSchema.parse({
          id: provider.providerId,
          enabled: provider.enabled,
          autoDetected: provider.autoDetected,
          repository,
          settings,
        }),
      };
    }, `workspace ${workspaceId} Git configuration`);
    return yield* validateHostSettings(
      () =>
        sharedRepoSchema.parse({
          ...row,
          defaultTargetBranch: {
            branch: row.defaultTargetBranch,
            remote: row.defaultTargetRemote ?? undefined,
          },
          defaultModel: model ?? undefined,
          agentDefaults: collections.agentDefaults,
          hooks: { beforeWorktreeRemoval: collections.commands },
          actions: { items: collections.actions, defaultActionId: row.defaultActionId },
          worktreeCopyPaths: collections.paths,
          promptOverrides: collections.prompts,
          git,
          removal: removal ?? undefined,
        }),
      `workspace ${workspaceId}`,
    );
  });

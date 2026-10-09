import {
  type GlobalConfig,
  globalConfigSchema,
  type PersistedGlobalConfigV2,
  persistedGlobalConfigV2Schema,
  type PersistedGlobalConfigV3,
  persistedGlobalConfigV3Schema,
  persistedGlobalConfigV4Schema,
  repoActionCommandLines,
} from "@openducktor/contracts";
import { z, type JSONType } from "zod";
import { HostValidationError } from "../effect/host-errors";
import { configValidationError } from "./config-validation-message";

type PersistedConfigObject = Record<string, JSONType>;
const persistedConfigObjectSchema = z.record(z.string(), z.json());
const isPersistedConfigObject = (value: JSONType | undefined): value is PersistedConfigObject =>
  persistedConfigObjectSchema.safeParse(value).success;

export type LoadedGlobalConfig = GlobalConfig;

export const createDefaultGlobalConfig = (): LoadedGlobalConfig =>
  globalConfigSchema.parse({ version: 4 });

const migrateReusablePrompts = (payload: PersistedConfigObject) => {
  const chat = payload.chat;
  if (!isPersistedConfigObject(chat) || !Array.isArray(chat.customPrompts)) {
    return payload;
  }

  const { customPrompts, ...currentChat } = chat;
  return {
    ...payload,
    chat: currentChat,
    ...(payload.reusablePrompts === undefined && { reusablePrompts: customPrompts }),
  };
};

const legacyAzureSettingsKeys = ["remoteMappings", "httpConsentCollectionUrl", "areaPath"] as const;

const migrateAzureProviderSettings = (workspaceId: string, provider: JSONType): JSONType => {
  if (!isPersistedConfigObject(provider) || provider.id !== "azure_devops") return provider;
  const legacyKeys = legacyAzureSettingsKeys.filter((key) => Object.hasOwn(provider, key));
  if (legacyKeys.length === 0) return provider;
  if (Object.hasOwn(provider, "settings")) {
    throw new HostValidationError({
      message: `Repository "${workspaceId}" contains both nested and legacy Azure DevOps settings.`,
    });
  }
  const migrated = { ...provider };
  const settings: PersistedConfigObject = {};
  for (const key of legacyKeys) {
    settings[key] = migrated[key]!;
    delete migrated[key];
  }
  return { ...migrated, settings };
};

const migrateRepositoryGitConfig = (workspaceId: string, workspace: JSONType): JSONType => {
  if (!isPersistedConfigObject(workspace) || !isPersistedConfigObject(workspace.git)) {
    return workspace;
  }

  let git = workspace.git;
  if (isPersistedConfigObject(git.providers)) {
    const { providers, ...withoutProviders } = git;
    const entries = Object.entries(providers);
    if (Object.hasOwn(withoutProviders, "provider")) {
      throw new HostValidationError({
        message: `Repository "${workspaceId}" contains both canonical and legacy Git provider configuration.`,
      });
    }
    if (entries.length > 1) {
      throw new HostValidationError({
        message: `Repository "${workspaceId}" has ${entries.length} legacy Git providers; only one provider can be configured.`,
      });
    }
    if (entries.length === 0) {
      git = withoutProviders;
    } else {
      const [providerId, config] = entries[0]!;
      git = {
        ...withoutProviders,
        provider: isPersistedConfigObject(config) ? { ...config, id: providerId } : config,
      };
    }
  }

  if (!Object.hasOwn(git, "provider")) {
    return git === workspace.git ? workspace : { ...workspace, git };
  }
  const provider = migrateAzureProviderSettings(workspaceId, git.provider!);
  return git === workspace.git && provider === git.provider
    ? workspace
    : { ...workspace, git: { ...git, provider } };
};

const migrateWorkspaces = (
  payload: PersistedConfigObject,
  migrate: (workspaceId: string, workspace: JSONType) => JSONType,
) => {
  if (!isPersistedConfigObject(payload.workspaces)) {
    return payload;
  }
  return {
    ...payload,
    workspaces: Object.fromEntries(
      Object.entries(payload.workspaces).map(([id, workspace]) => [id, migrate(id, workspace)]),
    ),
  };
};

const WORKTREE_SETUP_ACTION_ID = "worktree-setup";
const legacyPreStartSchema = z.array(z.string());

const uniqueActionId = (baseId: string, takenIds: ReadonlySet<JSONType>): string => {
  let id = baseId;
  for (let suffix = 1; takenIds.has(id); suffix += 1) id = `${baseId}-${suffix}`;
  return id;
};

// Converts the worktree setup script and dev servers into repository actions.
const migrateRepositoryActions = (workspaceId: string, workspace: JSONType): JSONType => {
  if (!isPersistedConfigObject(workspace)) return workspace;
  const hooks = workspace.hooks;
  const hasPreStart = isPersistedConfigObject(hooks) && Object.hasOwn(hooks, "preStart");
  const hasDevServers = Object.hasOwn(workspace, "devServers");
  if (!hasPreStart && !hasDevServers) return workspace;
  if (Object.hasOwn(workspace, "actions")) {
    throw new HostValidationError({
      message: `Repository "${workspaceId}" contains both actions and legacy dev server or worktree setup settings.`,
    });
  }
  const { devServers = [], ...migrated } = workspace;
  const preStart = legacyPreStartSchema.safeParse(hasPreStart ? hooks.preStart : []);
  if (!Array.isArray(devServers) || !preStart.success) {
    throw new HostValidationError({
      message: `Repository "${workspaceId}" has invalid legacy dev server or worktree setup settings.`,
    });
  }
  const items: JSONType[] = devServers.map((devServer) =>
    isPersistedConfigObject(devServer)
      ? { ...devServer, icon: "play", runOnWorktreeCreate: false, waitBeforeAgentStart: false }
      : devServer,
  );
  const setupLines = preStart.data.map((line) => line.trim()).filter(Boolean);
  let setupActionId: string | null = null;
  // A setup script with only comment lines ran nothing, so it becomes no action.
  if (repoActionCommandLines(setupLines.join("\n")).length > 0) {
    setupActionId = uniqueActionId(
      WORKTREE_SETUP_ACTION_ID,
      new Set(items.map((item) => (isPersistedConfigObject(item) ? (item.id ?? null) : null))),
    );
    items.unshift({
      id: setupActionId,
      icon: "configure",
      name: "Worktree setup",
      command: setupLines.join("\n"),
      runOnWorktreeCreate: true,
      waitBeforeAgentStart: true,
    });
  }
  const firstDevServer = devServers[0];
  const defaultActionId = isPersistedConfigObject(firstDevServer)
    ? (firstDevServer.id ?? null)
    : setupActionId;
  if (hasPreStart) {
    const { preStart: _preStart, ...currentHooks } = hooks;
    migrated.hooks = currentHooks;
  }
  return { ...migrated, actions: { items, defaultActionId } };
};

const migratePersistedConfig = (payload: PersistedConfigObject) => {
  const migrated = { ...payload };
  delete migrated.trustedHooks;
  delete migrated.trustedHooksFingerprint;
  if (isPersistedConfigObject(migrated.workspaces)) {
    migrated.workspaces = Object.fromEntries(
      Object.entries(migrated.workspaces).map(([id, workspace]) => {
        if (!isPersistedConfigObject(workspace)) {
          return [id, workspace];
        }
        const currentWorkspace = { ...workspace };
        delete currentWorkspace.defaultRuntimeKind;
        delete currentWorkspace.trustedHooks;
        delete currentWorkspace.trustedHooksFingerprint;
        return [id, currentWorkspace];
      }),
    );
  }
  return migrateWorkspaces(
    migrateWorkspaces(migrateReusablePrompts(migrated), migrateRepositoryGitConfig),
    migrateRepositoryActions,
  );
};

const parseSupportedConfigObject = (
  payload: JSONType,
  expectedVersion: 2 | 3 | 4,
): PersistedConfigObject => {
  if (!isPersistedConfigObject(payload)) {
    throw new HostValidationError({ message: "Config file must contain a JSON object." });
  }

  const version = payload.version;
  if (version !== expectedVersion) {
    throw new HostValidationError({
      message: `Unsupported config version ${String(version)}. Expected ${expectedVersion}.`,
    });
  }
  return payload;
};

const parsePersistedConfig = <Output>(
  payload: JSONType,
  expectedVersion: 2 | 3 | 4,
  schema: z.ZodType<Output>,
): Output => {
  let migrated: PersistedConfigObject;
  try {
    migrated = migratePersistedConfig(parseSupportedConfigObject(payload, expectedVersion));
  } catch (cause) {
    throw configValidationError(cause);
  }

  const parsed = schema.safeParse(migrated);
  if (!parsed.success) {
    throw configValidationError(parsed.error, migrated);
  }

  return parsed.data;
};

export const parsePersistedGlobalConfig = (payload: JSONType): LoadedGlobalConfig =>
  parsePersistedConfig(payload, 4, persistedGlobalConfigV4Schema);

export const parsePersistedGlobalConfigV3 = (payload: JSONType): PersistedGlobalConfigV3 =>
  parsePersistedConfig(payload, 3, persistedGlobalConfigV3Schema);

export const parsePersistedGlobalConfigV2 = (payload: JSONType): PersistedGlobalConfigV2 =>
  parsePersistedConfig(payload, 2, persistedGlobalConfigV2Schema);

export const readPersistedGlobalConfigVersion = (payload: JSONType): 2 | 3 | 4 => {
  if (!isPersistedConfigObject(payload)) {
    throw new HostValidationError({ message: "Config file must contain a JSON object." });
  }
  const version = payload.version;
  if (version === 2 || version === 3 || version === 4) {
    return version;
  }
  throw new HostValidationError({
    message: `Unsupported config version ${String(version)}. Expected 2, 3, or 4.`,
  });
};

export const upgradePersistedGlobalConfigV2 = (
  config: PersistedGlobalConfigV2,
  executablePaths: Record<string, string>,
): LoadedGlobalConfig => {
  const agentRuntimes = Object.fromEntries(
    Object.entries(config.agentRuntimes).map(([kind, runtime]) => [
      kind,
      {
        ...runtime,
        executablePath: executablePaths[kind] ?? "",
      },
    ]),
  );

  const payload = {
    ...config,
    version: 4,
    agentRuntimes,
  };
  const parsed = globalConfigSchema.safeParse(payload);
  if (!parsed.success) {
    throw configValidationError(parsed.error, payload);
  }

  return parsed.data;
};

export const upgradePersistedGlobalConfigV3 = (
  config: PersistedGlobalConfigV3,
): LoadedGlobalConfig => {
  const payload = { ...config, version: 4 };
  const parsed = globalConfigSchema.safeParse(payload);
  if (!parsed.success) {
    throw configValidationError(parsed.error, payload);
  }

  return parsed.data;
};

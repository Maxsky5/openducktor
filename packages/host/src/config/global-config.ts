import {
  type GlobalConfig,
  globalConfigSchema,
  type PersistedGlobalConfigV2,
  type PersistedGlobalConfigV3,
  persistedGlobalConfigV2Schema,
  persistedGlobalConfigV3Schema,
} from "@openducktor/contracts";
import { z, type JSONType } from "zod";
import { HostValidationError } from "../effect/host-errors";

type PersistedConfigObject = Record<string, JSONType>;
const persistedConfigObjectSchema = z.record(z.string(), z.json());
const isPersistedConfigObject = (value: JSONType | undefined): value is PersistedConfigObject =>
  persistedConfigObjectSchema.safeParse(value).success;

export type LoadedGlobalConfig = GlobalConfig;

export const createDefaultGlobalConfig = (): LoadedGlobalConfig =>
  globalConfigSchema.parse({ version: 4 });

const migrateReusablePrompts = (payload: PersistedConfigObject) => {
  const chat = payload.chat;
  const customPrompts = chat && isPersistedConfigObject(chat) ? chat.customPrompts : undefined;
  if (payload.reusablePrompts !== undefined || !Array.isArray(customPrompts)) {
    return payload;
  }

  return {
    ...payload,
    reusablePrompts: customPrompts,
  };
};

const migrateRepositoryGitConfig = (workspaceId: string, workspace: JSONType): JSONType => {
  if (!isPersistedConfigObject(workspace) || !isPersistedConfigObject(workspace.git)) {
    return workspace;
  }

  const { providers, ...git } = workspace.git;
  if (!isPersistedConfigObject(providers)) {
    return workspace;
  }

  const entries = Object.entries(providers);
  if (Object.hasOwn(git, "provider")) {
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
    return { ...workspace, git };
  }

  const [providerId, config] = entries[0]!;
  const provider = isPersistedConfigObject(config) ? { ...config, id: providerId } : config;
  return { ...workspace, git: { ...git, provider } };
};

const migrateRepositoryGitConfigs = (payload: PersistedConfigObject) => {
  if (!isPersistedConfigObject(payload.workspaces)) {
    return payload;
  }
  return {
    ...payload,
    workspaces: Object.fromEntries(
      Object.entries(payload.workspaces).map(([id, workspace]) => [
        id,
        migrateRepositoryGitConfig(id, workspace),
      ]),
    ),
  };
};

const migratePersistedConfig = (payload: PersistedConfigObject) =>
  migrateRepositoryGitConfigs(migrateReusablePrompts(payload));

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

export const parsePersistedGlobalConfig = (payload: JSONType): LoadedGlobalConfig => {
  try {
    return globalConfigSchema.parse(migratePersistedConfig(parseSupportedConfigObject(payload, 4)));
  } catch (cause) {
    throw new HostValidationError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
};

export const parsePersistedGlobalConfigV3 = (payload: JSONType): PersistedGlobalConfigV3 => {
  try {
    return persistedGlobalConfigV3Schema.parse(
      migratePersistedConfig(parseSupportedConfigObject(payload, 3)),
    );
  } catch (cause) {
    throw new HostValidationError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
};

export const parsePersistedGlobalConfigV2 = (payload: JSONType): PersistedGlobalConfigV2 => {
  try {
    return persistedGlobalConfigV2Schema.parse(
      migratePersistedConfig(parseSupportedConfigObject(payload, 2)),
    );
  } catch (cause) {
    throw new HostValidationError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
};

export const readPersistedGlobalConfigVersion = (payload: JSONType): 2 | 3 | 4 => {
  if (!isPersistedConfigObject(payload)) {
    throw new HostValidationError({ message: "Config file must contain a JSON object." });
  }
  const version = payload.version;
  if (version === 2 || version === 3 || version === 4) {
    return version;
  }
  throw new HostValidationError({
    message: `Unsupported config version ${String(version)}. Expected 2, 3 or 4.`,
  });
};

const inferOnboardingCompleted = (config: {
  workspaces: object;
  onboardingCompleted?: boolean;
}): boolean => config.onboardingCompleted === true || Object.keys(config.workspaces).length > 0;

export const upgradePersistedGlobalConfigV3 = (
  config: PersistedGlobalConfigV3,
): LoadedGlobalConfig =>
  globalConfigSchema.parse({
    ...config,
    version: 4,
    onboardingCompleted: inferOnboardingCompleted(config),
  });

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

  return globalConfigSchema.parse({
    ...config,
    version: 4,
    agentRuntimes,
    onboardingCompleted: inferOnboardingCompleted(config),
  });
};

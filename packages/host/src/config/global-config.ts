import {
  type GlobalConfig,
  globalConfigSchema,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  type PersistedGlobalConfigV2,
  persistedGlobalConfigV2Schema,
} from "@openducktor/contracts";
import { HostValidationError } from "../effect/host-errors";

export type LoadedGlobalConfig = GlobalConfig;

export const createDefaultGlobalConfig = (): LoadedGlobalConfig =>
  globalConfigSchema.parse({ version: 3 });

const migratePersistedConfig = (payload: JsonObject): JsonObject => {
  const chat = payload.chat;
  const customPrompts = chat && isJsonObject(chat) ? chat.customPrompts : undefined;
  if (payload.reusablePrompts !== undefined || !Array.isArray(customPrompts)) {
    return payload;
  }

  return {
    ...payload,
    reusablePrompts: customPrompts,
  };
};

const parseSupportedConfigObject = (payload: JsonValue, expectedVersion: 2 | 3): JsonObject => {
  if (!isJsonObject(payload)) {
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

export const parsePersistedGlobalConfig = (payload: JsonValue): LoadedGlobalConfig => {
  try {
    return globalConfigSchema.parse(migratePersistedConfig(parseSupportedConfigObject(payload, 3)));
  } catch (cause) {
    throw new HostValidationError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
};

export const parsePersistedGlobalConfigV2 = (payload: JsonValue): PersistedGlobalConfigV2 => {
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

export const readPersistedGlobalConfigVersion = (payload: JsonValue): 2 | 3 => {
  if (!isJsonObject(payload)) {
    throw new HostValidationError({ message: "Config file must contain a JSON object." });
  }
  const version = payload.version;
  if (version === 2 || version === 3) {
    return version;
  }
  throw new HostValidationError({
    message: `Unsupported config version ${String(version)}. Expected 2 or 3.`,
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

  return globalConfigSchema.parse({
    ...config,
    version: 3,
    agentRuntimes,
  });
};

import {
  type AgentRuntimes,
  type GlobalConfig,
  globalConfigSchema,
  type PersistedGlobalConfigV2,
  persistedGlobalConfigV2Schema,
} from "@openducktor/contracts";
import { HostValidationError } from "../effect/host-errors";
import type { JsonValue } from "@openducktor/contracts";

export type LoadedGlobalConfig = GlobalConfig & {
  agentRuntimes: AgentRuntimes;
};

export const createDefaultGlobalConfig = (): LoadedGlobalConfig =>
  globalConfigSchema.parse({ version: 3 }) as LoadedGlobalConfig;

const migratePersistedConfigShape = (payload: unknown): unknown => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const candidate = payload as Record<string, JsonValue>;
  const chat = candidate.chat;
  if (
    candidate.reusablePrompts !== undefined ||
    !chat ||
    typeof chat !== "object" ||
    Array.isArray(chat) ||
    !Array.isArray((chat as Record<string, JsonValue>).customPrompts)
  ) {
    return payload;
  }

  return {
    ...candidate,
    reusablePrompts: (chat as Record<string, JsonValue>).customPrompts,
  };
};

const assertSupportedConfigVersion = (payload: unknown, expectedVersion: 2 | 3): void => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HostValidationError({ message: "Config file must contain a JSON object." });
  }

  const version = (payload as Record<string, JsonValue>).version;
  if (version !== expectedVersion) {
    throw new HostValidationError({
      message: `Unsupported config version ${String(version)}. Expected ${expectedVersion}.`,
    });
  }
};

export const parsePersistedGlobalConfig = (payload: unknown): LoadedGlobalConfig => {
  assertSupportedConfigVersion(payload, 3);
  try {
    return globalConfigSchema.parse(migratePersistedConfigShape(payload)) as LoadedGlobalConfig;
  } catch (cause) {
    throw new HostValidationError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
};

export const parsePersistedGlobalConfigV2 = (payload: unknown): PersistedGlobalConfigV2 => {
  assertSupportedConfigVersion(payload, 2);
  try {
    return persistedGlobalConfigV2Schema.parse(migratePersistedConfigShape(payload));
  } catch (cause) {
    throw new HostValidationError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
};

export const readPersistedGlobalConfigVersion = (payload: unknown): 2 | 3 => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HostValidationError({ message: "Config file must contain a JSON object." });
  }
  const version = (payload as Record<string, JsonValue>).version;
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
  }) as LoadedGlobalConfig;
};

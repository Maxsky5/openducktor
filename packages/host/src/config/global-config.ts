import { type AgentRuntimes, type GlobalConfig, globalConfigSchema } from "@openducktor/contracts";
import { HostValidationError } from "../effect/host-errors";

export type LoadedGlobalConfig = GlobalConfig & {
  agentRuntimes: AgentRuntimes;
};

export const createDefaultGlobalConfig = (): LoadedGlobalConfig =>
  globalConfigSchema.parse({ version: 2 }) as LoadedGlobalConfig;

export const migratePersistedConfigShape = (payload: unknown): unknown => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const candidate = payload as Record<string, unknown>;
  const chat = candidate.chat;
  if (
    candidate.reusablePrompts !== undefined ||
    !chat ||
    typeof chat !== "object" ||
    Array.isArray(chat) ||
    !Array.isArray((chat as Record<string, unknown>).customPrompts)
  ) {
    return payload;
  }

  return {
    ...candidate,
    reusablePrompts: (chat as Record<string, unknown>).customPrompts,
  };
};

export const assertSupportedConfigVersion = (payload: unknown): void => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HostValidationError({ message: "Config file must contain a JSON object." });
  }

  const version = (payload as Record<string, unknown>).version;
  if (version !== 2) {
    throw new HostValidationError({
      message: `Unsupported config version ${String(version)}. Expected 2.`,
    });
  }
};

export const parsePersistedGlobalConfig = (payload: unknown): LoadedGlobalConfig => {
  assertSupportedConfigVersion(payload);
  try {
    return globalConfigSchema.parse(migratePersistedConfigShape(payload)) as LoadedGlobalConfig;
  } catch (cause) {
    throw new HostValidationError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
};

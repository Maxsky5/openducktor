import type { Part } from "@opencode-ai/sdk/v2/client";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

export const normalizeModelInput = (
  model: AgentModelSelection | undefined,
): {
  model?: { providerID: string; modelID: string };
  variant?: string;
  agent?: string;
} => {
  if (!model) {
    return {};
  }

  return {
    model: {
      providerID: model.providerId,
      modelID: model.modelId,
    },
    ...(model.variant ? { variant: model.variant } : {}),
    ...(model.opencodeAgent ? { agent: model.opencodeAgent } : {}),
  };
};

export const resolveAssistantResponseMessageId = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const infoId = ((payload as { info?: { id?: unknown } }).info?.id ?? null) as unknown;
  if (typeof infoId === "string" && infoId.trim().length > 0) {
    return infoId.trim();
  }

  const parts = (payload as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) {
    return null;
  }
  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const messageId = (part as { messageID?: unknown }).messageID;
    if (typeof messageId === "string" && messageId.trim().length > 0) {
      return messageId.trim();
    }
  }
  return null;
};

export const toToolIdList = (payload: unknown): string[] => {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "invalid");
};

export const mapProviderListToCatalog = (payload: unknown): AgentModelCatalog => {
  if (!payload || typeof payload !== "object") {
    return { models: [], defaultModelsByProvider: {}, agents: [] };
  }

  const providers = Array.isArray((payload as { providers?: unknown }).providers)
    ? ((payload as { providers: Array<unknown> }).providers as Array<unknown>)
    : [];
  const defaults =
    typeof (payload as { default?: unknown }).default === "object" &&
    (payload as { default?: unknown }).default !== null
      ? ((payload as { default: Record<string, string> }).default ?? {})
      : {};

  const models = providers.flatMap((provider) => {
    if (!provider || typeof provider !== "object") {
      return [];
    }
    const providerId = (provider as { id?: unknown }).id;
    const providerName = (provider as { name?: unknown }).name;
    const rawModels = (provider as { models?: unknown }).models;
    if (
      typeof providerId !== "string" ||
      typeof providerName !== "string" ||
      !rawModels ||
      typeof rawModels !== "object"
    ) {
      return [];
    }

    return Object.entries(rawModels as Record<string, unknown>)
      .map(([modelId, rawModel]) => {
        if (!rawModel || typeof rawModel !== "object") {
          return null;
        }
        const modelName = (rawModel as { name?: unknown }).name;
        const variantsRaw = (rawModel as { variants?: unknown }).variants;
        const limitRaw = (rawModel as { limit?: unknown }).limit;
        const contextWindow =
          limitRaw && typeof limitRaw === "object"
            ? (toFiniteNumber((limitRaw as { context?: unknown }).context) ?? undefined)
            : undefined;
        const outputLimit =
          limitRaw && typeof limitRaw === "object"
            ? (toFiniteNumber((limitRaw as { output?: unknown }).output) ?? undefined)
            : undefined;
        const variants =
          variantsRaw && typeof variantsRaw === "object"
            ? Object.keys(variantsRaw as Record<string, unknown>)
            : [];

        return {
          id: `${providerId}/${modelId}`,
          providerId,
          providerName,
          modelId,
          modelName: typeof modelName === "string" ? modelName : modelId,
          variants,
          ...(typeof contextWindow === "number" ? { contextWindow } : {}),
          ...(typeof outputLimit === "number" ? { outputLimit } : {}),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  });

  return {
    models,
    defaultModelsByProvider: defaults,
    agents: [],
  };
};

import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { asUnknownRecord, readArrayProp, readRecordProp, readUnknownProp } from "./guards";

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
  const payloadRecord = asUnknownRecord(payload);
  if (!payloadRecord) {
    return null;
  }
  const infoId = readUnknownProp(readRecordProp(payloadRecord, "info"), "id");
  if (typeof infoId === "string" && infoId.trim().length > 0) {
    return infoId.trim();
  }

  const parts = readArrayProp(payloadRecord, "parts");
  if (!parts) {
    return null;
  }
  for (const part of parts) {
    const partRecord = asUnknownRecord(part);
    if (!partRecord) {
      continue;
    }
    const messageId = readUnknownProp(partRecord, "messageID");
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
  const payloadRecord = asUnknownRecord(payload);
  if (!payloadRecord) {
    return { models: [], defaultModelsByProvider: {}, agents: [] };
  }

  const providers = readArrayProp(payloadRecord, "providers") ?? [];
  const defaultsRaw = readRecordProp(payloadRecord, "default");
  const defaults: Record<string, string> = {};
  if (defaultsRaw) {
    for (const [providerId, modelId] of Object.entries(defaultsRaw)) {
      if (typeof modelId === "string") {
        defaults[providerId] = modelId;
      }
    }
  }

  const models = providers.flatMap((provider) => {
    const providerRecord = asUnknownRecord(provider);
    if (!providerRecord) {
      return [];
    }
    const providerId = readUnknownProp(providerRecord, "id");
    const providerName = readUnknownProp(providerRecord, "name");
    const rawModels = readRecordProp(providerRecord, "models");
    if (typeof providerId !== "string" || typeof providerName !== "string" || !rawModels) {
      return [];
    }

    return Object.entries(rawModels)
      .map(([modelId, rawModel]) => {
        const modelRecord = asUnknownRecord(rawModel);
        if (!modelRecord) {
          return null;
        }
        const modelName = readUnknownProp(modelRecord, "name");
        const variantsRaw = readRecordProp(modelRecord, "variants");
        const limitRaw = readRecordProp(modelRecord, "limit");
        const contextRaw = readUnknownProp(limitRaw, "context");
        const outputRaw = readUnknownProp(limitRaw, "output");
        const contextWindow = limitRaw ? (toFiniteNumber(contextRaw) ?? undefined) : undefined;
        const outputLimit = limitRaw ? (toFiniteNumber(outputRaw) ?? undefined) : undefined;
        const variants = variantsRaw ? Object.keys(variantsRaw) : [];

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

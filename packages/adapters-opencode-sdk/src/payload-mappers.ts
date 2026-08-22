import type { JsonValue } from "@openducktor/contracts";
import {
  jsonValueSchema,
  OPENCODE_RUNTIME_DESCRIPTOR,
  hasRuntimeType,
} from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { asUnknownRecord, readArrayProp, readRecordProp, readUnknownProp } from "./guards";
import {
  opencodeProviderCatalogPayloadSchema,
  type ParsedOpencodeProviderCatalog,
} from "./opencode-ingress";

const ATTACHMENT_MODALITIES = ["image", "audio", "video", "pdf"] as const;

type ProviderCatalogModel = {
  name?: string | undefined;
  variants?: Record<string, JsonValue> | undefined;
  limit?: { context?: number | undefined; output?: number | undefined } | undefined;
  capabilities?:
    | {
        input?:
          | Partial<Record<(typeof ATTACHMENT_MODALITIES)[number], boolean | undefined>>
          | undefined;
      }
    | undefined;
  modalities?: { input?: string[] | undefined } | undefined;
};

interface NormalizedModelInput {
  model?: { providerID: string; modelID: string };
  variant?: string;
  agent?: string;
}

export const normalizeModelInput = (
  model: AgentModelSelection | undefined,
): NormalizedModelInput => {
  if (!model) {
    return {};
  }

  return {
    model: {
      providerID: model.providerId,
      modelID: model.modelId,
    },
    ...(model.variant ? { variant: model.variant } : undefined),
    ...(model.profileId ? { agent: model.profileId } : undefined),
  };
};

export const resolveAssistantResponseMessageId = (
  payload: Parameters<typeof jsonValueSchema.safeParse>[0],
): string | null => {
  const parsed = jsonValueSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  const payloadRecord = asUnknownRecord(parsed.data);
  if (!payloadRecord) {
    return null;
  }
  const infoId = readUnknownProp(readRecordProp(payloadRecord, "info"), "id");
  if (hasRuntimeType(infoId, "string") && infoId.trim().length > 0) {
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
    if (hasRuntimeType(messageId, "string") && messageId.trim().length > 0) {
      return messageId.trim();
    }
  }
  return null;
};

export const toToolIdList = (payload: JsonValue | undefined): string[] => {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "invalid");
};

const normalizeModelAttachmentSupport = (
  model: ProviderCatalogModel,
):
  | {
      image: boolean;
      audio: boolean;
      video: boolean;
      pdf: boolean;
    }
  | undefined => {
  const capabilitiesInput = model.capabilities?.input;
  if (capabilitiesInput) {
    return {
      image: capabilitiesInput.image === true,
      audio: capabilitiesInput.audio === true,
      video: capabilitiesInput.video === true,
      pdf: capabilitiesInput.pdf === true,
    };
  }

  const modalitiesInput = model.modalities?.input;
  if (modalitiesInput) {
    const supported = new Set(
      modalitiesInput.filter((entry): entry is (typeof ATTACHMENT_MODALITIES)[number] =>
        ATTACHMENT_MODALITIES.some((modality) => modality === entry),
      ),
    );
    return {
      image: supported.has("image"),
      audio: supported.has("audio"),
      video: supported.has("video"),
      pdf: supported.has("pdf"),
    };
  }

  return undefined;
};

export const mapProviderListToCatalog = (
  payload: Parameters<typeof opencodeProviderCatalogPayloadSchema.parse>[0],
): AgentModelCatalog => {
  const parsed: ParsedOpencodeProviderCatalog = opencodeProviderCatalogPayloadSchema.parse(payload);
  const defaults = { ...parsed.default };

  const models = parsed.providers.flatMap((provider) => {
    const providerId = provider.id;
    const providerName = provider.name;
    const providerModels = provider.models;
    if (!providerId || !providerName || !providerModels) {
      return [];
    }

    return Object.entries(providerModels).map(([modelId, rawModel]) => {
      const contextWindow = rawModel.limit?.context;
      const outputLimit = rawModel.limit?.output;
      const variants = rawModel.variants ? Object.keys(rawModel.variants) : [];
      const attachmentSupport = normalizeModelAttachmentSupport(rawModel);

      return {
        id: `${providerId}/${modelId}`,
        providerId,
        providerName,
        modelId,
        modelName: rawModel.name ?? modelId,
        variants,
        ...(hasRuntimeType(contextWindow, "number") && Number.isFinite(contextWindow)
          ? { contextWindow }
          : undefined),
        ...(hasRuntimeType(outputLimit, "number") && Number.isFinite(outputLimit)
          ? { outputLimit }
          : undefined),
        ...(attachmentSupport ? { attachmentSupport } : undefined),
      };
    });
  });

  return {
    runtime: OPENCODE_RUNTIME_DESCRIPTOR,
    models,
    defaultModelsByProvider: defaults,
    profiles: [],
  };
};

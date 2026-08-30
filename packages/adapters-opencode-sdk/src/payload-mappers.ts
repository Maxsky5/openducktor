import type { ConfigProvidersResponse } from "@opencode-ai/sdk/v2/client";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import {
  opencodeProviderCatalogPayloadSchema,
  type ParsedOpencodeProviderModel,
} from "./opencode-ingress";

type AssistantResponsePayload = {
  info?: { id?: string };
  parts?: Array<{ messageID?: string }>;
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

  const normalized: NormalizedModelInput = {
    model: {
      providerID: model.providerId,
      modelID: model.modelId,
    },
  };
  if (model.variant) {
    normalized.variant = model.variant;
  }
  if (model.profileId) {
    normalized.agent = model.profileId;
  }
  return normalized;
};

export const resolveAssistantResponseMessageId = (
  payload: AssistantResponsePayload | undefined,
): string | null => {
  const infoId = payload?.info?.id?.trim();
  if (infoId) {
    return infoId;
  }

  for (const part of payload?.parts ?? []) {
    const messageId = part.messageID?.trim();
    if (messageId) {
      return messageId;
    }
  }
  return null;
};

export const toToolIdList = (payload: readonly string[]): string[] => {
  return payload
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "invalid");
};

const normalizeModelAttachmentSupport = (
  model: ParsedOpencodeProviderModel,
): NonNullable<AgentModelCatalog["models"][number]["attachmentSupport"]> => ({
  audio: model.capabilities.input.audio,
  image: model.capabilities.input.image,
  pdf: model.capabilities.input.pdf,
  video: model.capabilities.input.video,
});

export const mapProviderListToCatalog = (payload: ConfigProvidersResponse): AgentModelCatalog => {
  const parsed = opencodeProviderCatalogPayloadSchema.parse(payload);
  const defaults = { ...parsed.default };

  const models = parsed.providers.flatMap((provider) => {
    return Object.entries(provider.models).map(([modelId, rawModel]) => {
      const variants = rawModel.variants ? Object.keys(rawModel.variants) : [];
      const attachmentSupport = normalizeModelAttachmentSupport(rawModel);

      return {
        id: `${provider.id}/${modelId}`,
        providerId: provider.id,
        providerName: provider.name,
        modelId,
        modelName: rawModel.name,
        variants,
        contextWindow: rawModel.limit.context,
        outputLimit: rawModel.limit.output,
        attachmentSupport,
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

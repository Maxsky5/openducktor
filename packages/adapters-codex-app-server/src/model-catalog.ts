import {
  CODEX_RUNTIME_DESCRIPTOR,
  codexAppServerReasoningEffortSchema,
} from "@openducktor/contracts";
import type {
  AgentModelAttachmentSupport,
  AgentModelCatalog,
  AgentModelSelection,
} from "@openducktor/core";
import { CODEX_MODEL_CATALOG_TTL_MS } from "./codex-app-server-shared";
import type { CodexAppServerClient, CodexModelListResponse } from "./types";

export const CODEX_MODEL_PROVIDER_ID = "codex";
/** Codex uses this service tier for standard speed. */
export const CODEX_STANDARD_SERVICE_TIER = "default";

export const requireModelSelection = (
  model: AgentModelSelection | undefined,
): AgentModelSelection => {
  if (!model) {
    throw new Error("Codex App Server requires a model selection.");
  }
  return model;
};

const validateModelSelection = (
  catalog: CodexModelListResponse,
  model: AgentModelSelection,
): void => {
  const record = catalog.data.find(
    (candidate) => candidate.model === model.modelId || candidate.id === model.modelId,
  );
  if (!record) {
    throw new Error(
      `Codex model '${model.providerId}/${model.modelId}' was not found in model/list.`,
    );
  }
  const supportedEfforts = record.supportedReasoningEfforts.map((effort) => effort.reasoningEffort);
  if (model.variant !== undefined && !supportedEfforts.includes(model.variant)) {
    throw new Error(
      `Codex model '${model.providerId}/${model.modelId}' does not support reasoning effort '${model.variant}'.`,
    );
  }
  if (model.speed !== undefined && !record.serviceTiers.some((tier) => tier.id === model.speed)) {
    throw new Error(
      `Codex model '${model.providerId}/${model.modelId}' does not support service tier '${model.speed}'.`,
    );
  }
};

export const toTransportModelSelection = (model: AgentModelSelection) => {
  // An explicit null keeps a native default tier from changing the selected speed.
  const transport = { model: model.modelId, serviceTier: model.speed ?? null };
  return model.variant === undefined
    ? transport
    : { ...transport, effort: codexAppServerReasoningEffortSchema.parse(model.variant) };
};

const toAttachmentSupport = (inputModalities: string[]): AgentModelAttachmentSupport => {
  return {
    image: inputModalities.includes("image"),
    audio: false,
    video: false,
    pdf: false,
  };
};

const toModelDescriptor = (
  model: CodexModelListResponse["data"][number],
): AgentModelCatalog["models"][number] => {
  const descriptor: AgentModelCatalog["models"][number] = {
    id: model.id,
    providerId: CODEX_MODEL_PROVIDER_ID,
    providerName: "Codex",
    modelId: model.model,
    modelName: model.displayName,
    variants: model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
    attachmentSupport: toAttachmentSupport(model.inputModalities),
  };
  const speedLevels = model.serviceTiers
    .filter((tier) => tier.id !== CODEX_STANDARD_SERVICE_TIER)
    .map((tier) => ({ id: tier.id, label: tier.name, description: tier.description }));
  if (speedLevels.length > 0) descriptor.speedLevels = speedLevels;
  return descriptor;
};

export const toCatalog = (response: CodexModelListResponse): AgentModelCatalog => ({
  runtime: CODEX_RUNTIME_DESCRIPTOR,
  models: response.data.map(toModelDescriptor),
  defaultModelsByProvider: response.data.some((model) => model.isDefault)
    ? {
        [CODEX_MODEL_PROVIDER_ID]:
          response.data.find((model) => model.isDefault)?.model ?? response.data[0]?.model ?? "",
      }
    : {},
});

type CachedCodexModelList = {
  value?: CodexModelListResponse;
  fetchedAtMs?: number;
  pending?: Promise<CodexModelListResponse>;
};

export class CodexModels {
  private readonly modelListByRuntimeId = new Map<string, CachedCodexModelList>();

  async list(client: CodexAppServerClient, runtimeId: string): Promise<CodexModelListResponse> {
    const now = Date.now();
    const cached = this.modelListByRuntimeId.get(runtimeId);
    if (
      cached?.value &&
      cached.fetchedAtMs !== undefined &&
      now - cached.fetchedAtMs < CODEX_MODEL_CATALOG_TTL_MS
    ) {
      return cached.value;
    }
    if (cached?.pending) {
      return cached.pending;
    }
    const pending = client.modelList().then(
      (value) => {
        this.modelListByRuntimeId.set(runtimeId, { value, fetchedAtMs: Date.now() });
        return value;
      },
      (error) => {
        this.modelListByRuntimeId.delete(runtimeId);
        throw error;
      },
    );
    const nextCached: CachedCodexModelList = { pending };
    if (cached?.value && cached.fetchedAtMs !== undefined) {
      nextCached.value = cached.value;
      nextCached.fetchedAtMs = cached.fetchedAtMs;
    }
    this.modelListByRuntimeId.set(runtimeId, nextCached);
    return pending;
  }

  async validate(
    client: CodexAppServerClient,
    runtimeId: string,
    model: AgentModelSelection,
  ): Promise<void> {
    validateModelSelection(await this.list(client, runtimeId), model);
  }
}

import { CODEX_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type {
  AgentModelAttachmentSupport,
  AgentModelCatalog,
  AgentModelSelection,
} from "@openducktor/core";
import { CODEX_MODEL_CATALOG_TTL_MS } from "./codex-app-server-shared";
import type { CodexAppServerClient, CodexModelListResponse } from "./types";

export const requireModelSelection = (
  model: AgentModelSelection | undefined,
): AgentModelSelection => {
  if (!model) {
    throw new Error("Codex App Server requires a model selection with a reasoning effort variant.");
  }
  if (!model.variant) {
    throw new Error(
      `Codex model '${model.providerId}/${model.modelId}' requires a reasoning effort variant.`,
    );
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
  if (!supportedEfforts.includes(model.variant ?? "")) {
    throw new Error(
      `Codex model '${model.providerId}/${model.modelId}' does not support reasoning effort '${model.variant}'.`,
    );
  }
};

export const toTransportModelSelection = (model: AgentModelSelection) => ({
  model: model.modelId,
  effort: model.variant as string,
});

const toAttachmentSupport = (inputModalities: string[]): AgentModelAttachmentSupport => {
  return {
    image: inputModalities.includes("image"),
    audio: false,
    video: false,
    pdf: false,
  };
};

export const toCatalog = (response: CodexModelListResponse): AgentModelCatalog => ({
  runtime: CODEX_RUNTIME_DESCRIPTOR,
  models: response.data.map((model) => ({
    id: model.id,
    providerId: "codex",
    providerName: "Codex",
    modelId: model.model,
    modelName: model.displayName,
    variants: model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
    attachmentSupport: toAttachmentSupport(model.inputModalities),
  })),
  defaultModelsByProvider: response.data.some((model) => model.isDefault)
    ? {
        codex:
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
      typeof cached.fetchedAtMs === "number" &&
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
    this.modelListByRuntimeId.set(runtimeId, {
      ...(cached?.value ? { value: cached.value, fetchedAtMs: cached.fetchedAtMs } : {}),
      pending,
    });
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

import { CODEX_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import type { CodexModelListResponse } from "./types";

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

export const validateModelSelection = (
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

export const toCatalog = (response: CodexModelListResponse): AgentModelCatalog => ({
  runtime: CODEX_RUNTIME_DESCRIPTOR,
  models: response.data.map((model) => ({
    id: model.id,
    providerId: "codex",
    providerName: "Codex",
    modelId: model.model,
    modelName: model.displayName,
    variants: model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
  })),
  defaultModelsByProvider: response.data.some((model) => model.isDefault)
    ? {
        codex:
          response.data.find((model) => model.isDefault)?.model ?? response.data[0]?.model ?? "",
      }
    : {},
});

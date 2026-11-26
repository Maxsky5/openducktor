import type { AgentSessionRecord } from "@openducktor/contracts";

export const selectedModelColumns = (model: AgentSessionRecord["selectedModel"]) => ({
  modelRuntimeKind: model?.runtimeKind ?? null,
  modelProviderId: model?.providerId ?? null,
  modelId: model?.modelId ?? null,
  modelVariant: model?.variant ?? null,
  modelProfileId: model?.profileId ?? null,
  modelSpeed: model?.speed ?? null,
});

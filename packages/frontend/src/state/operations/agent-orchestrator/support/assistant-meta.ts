import type { AgentRole } from "@openducktor/core";
import type {
  AgentChatMessage,
  AgentSessionContextUsage,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { mergeModelSelection } from "./models";

type AssistantMessageMetaInput = {
  role: AgentRole | null;
  model?: AgentSessionState["selectedModel"] | undefined;
  isFinal: boolean;
  durationMs?: number | undefined;
  totalTokens?: number | undefined;
  contextWindow?: number | undefined;
  outputLimit?: number | undefined;
};

export const toSessionContextUsage = (
  session: AgentSessionState,
  totalTokens: number | undefined,
  model?: AgentSessionState["selectedModel"],
): AgentSessionContextUsage | null => {
  if (totalTokens === undefined || totalTokens <= 0) {
    return null;
  }

  const effectiveModel = mergeModelSelection(session.selectedModel, model ?? undefined);
  const contextUsage: AgentSessionContextUsage = { totalTokens };
  if (effectiveModel?.providerId) {
    contextUsage.providerId = effectiveModel.providerId;
  }
  if (effectiveModel?.modelId) {
    contextUsage.modelId = effectiveModel.modelId;
  }
  if (effectiveModel?.variant) {
    contextUsage.variant = effectiveModel.variant;
  }
  if (effectiveModel?.profileId) {
    contextUsage.profileId = effectiveModel.profileId;
  }
  return contextUsage;
};

export const createAssistantMessageMeta = ({
  role,
  model,
  isFinal,
  durationMs,
  totalTokens,
  contextWindow,
  outputLimit,
}: AssistantMessageMetaInput): Extract<
  NonNullable<AgentChatMessage["meta"]>,
  { kind: "assistant" }
> => {
  const effectiveModel = mergeModelSelection(null, model ?? undefined);
  const meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }> = {
    kind: "assistant",
    isFinal,
  };
  if (role) {
    meta.agentRole = role;
  }
  if (effectiveModel?.providerId) {
    meta.providerId = effectiveModel.providerId;
  }
  if (effectiveModel?.modelId) {
    meta.modelId = effectiveModel.modelId;
  }
  if (effectiveModel?.variant) {
    meta.variant = effectiveModel.variant;
  }
  if (effectiveModel?.profileId) {
    meta.profileId = effectiveModel.profileId;
  }
  if (durationMs !== undefined) {
    meta.durationMs = durationMs;
  }
  if (totalTokens !== undefined && totalTokens > 0) {
    meta.totalTokens = totalTokens;
  }
  if (contextWindow !== undefined && contextWindow > 0) {
    meta.contextWindow = contextWindow;
  }
  if (outputLimit !== undefined && outputLimit > 0) {
    meta.outputLimit = outputLimit;
  }
  return meta;
};

export const toAssistantMessageMeta = (
  session: AgentSessionState,
  durationMs?: number,
  totalTokens?: number,
  model?: AgentSessionState["selectedModel"],
): Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }> => {
  return createAssistantMessageMeta({
    role: session.sessionAssociation.kind === "workflow" ? session.sessionAssociation.role : null,
    isFinal: true,
    model,
    durationMs,
    totalTokens,
  });
};

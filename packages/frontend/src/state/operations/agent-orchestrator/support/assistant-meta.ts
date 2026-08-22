import { hasRuntimeType } from "@openducktor/contracts";
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
  if (!hasRuntimeType(totalTokens, "number") || totalTokens <= 0) {
    return null;
  }

  const effectiveModel = mergeModelSelection(session.selectedModel, model ?? undefined);

  return {
    totalTokens,
    ...(() => {
      if (effectiveModel?.providerId) {
        return { providerId: effectiveModel.providerId };
      }
      return {};
    })(),
    ...(() => {
      if (effectiveModel?.modelId) {
        return { modelId: effectiveModel.modelId };
      }
      return {};
    })(),
    ...(() => {
      if (effectiveModel?.variant) {
        return { variant: effectiveModel.variant };
      }
      return {};
    })(),
    ...(() => {
      if (effectiveModel?.profileId) {
        return { profileId: effectiveModel.profileId };
      }
      return {};
    })(),
  };
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
  return {
    kind: "assistant",
    isFinal,
    ...(() => {
      if (role) {
        return { agentRole: role };
      }
      return {};
    })(),
    ...(() => {
      if (effectiveModel?.providerId) {
        return { providerId: effectiveModel.providerId };
      }
      return {};
    })(),
    ...(() => {
      if (effectiveModel?.modelId) {
        return { modelId: effectiveModel.modelId };
      }
      return {};
    })(),
    ...(() => {
      if (effectiveModel?.variant) {
        return { variant: effectiveModel.variant };
      }
      return {};
    })(),
    ...(() => {
      if (effectiveModel?.profileId) {
        return { profileId: effectiveModel.profileId };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(durationMs, "number")) {
        return { durationMs };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(totalTokens, "number") && totalTokens > 0) {
        return { totalTokens };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(contextWindow, "number") && contextWindow > 0) {
        return { contextWindow };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(outputLimit, "number") && outputLimit > 0) {
        return { outputLimit };
      }
      return {};
    })(),
  };
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

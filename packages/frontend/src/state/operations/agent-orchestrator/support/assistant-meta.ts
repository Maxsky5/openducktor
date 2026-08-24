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
  if (!(typeof totalTokens === "number") || totalTokens <= 0) {
    return null;
  }

  const effectiveModel = mergeModelSelection(session.selectedModel, model ?? undefined);

  return {
    totalTokens,
    ...(effectiveModel?.providerId ? { providerId: effectiveModel.providerId } : undefined),
    ...(effectiveModel?.modelId ? { modelId: effectiveModel.modelId } : undefined),
    ...(effectiveModel?.variant ? { variant: effectiveModel.variant } : undefined),
    ...(effectiveModel?.profileId ? { profileId: effectiveModel.profileId } : undefined),
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
    ...(role ? { agentRole: role } : undefined),
    ...(effectiveModel?.providerId ? { providerId: effectiveModel.providerId } : undefined),
    ...(effectiveModel?.modelId ? { modelId: effectiveModel.modelId } : undefined),
    ...(effectiveModel?.variant ? { variant: effectiveModel.variant } : undefined),
    ...(effectiveModel?.profileId ? { profileId: effectiveModel.profileId } : undefined),
    ...(typeof durationMs === "number" ? { durationMs } : undefined),
    ...(typeof totalTokens === "number" && totalTokens > 0 ? { totalTokens } : undefined),
    ...(typeof contextWindow === "number" && contextWindow > 0 ? { contextWindow } : undefined),
    ...(typeof outputLimit === "number" && outputLimit > 0 ? { outputLimit } : undefined),
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

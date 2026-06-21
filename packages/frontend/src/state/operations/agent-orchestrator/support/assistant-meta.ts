import type {
  AgentChatMessage,
  AgentSessionContextUsage,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { mergeModelSelection } from "./models";

type AssistantMessageMetaInput = {
  role: AgentSessionState["role"] | null;
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
  if (typeof totalTokens !== "number" || totalTokens <= 0) {
    return null;
  }

  const effectiveModel = mergeModelSelection(session.selectedModel, model ?? undefined);

  return {
    totalTokens,
    ...(effectiveModel?.providerId ? { providerId: effectiveModel.providerId } : {}),
    ...(effectiveModel?.modelId ? { modelId: effectiveModel.modelId } : {}),
    ...(effectiveModel?.variant ? { variant: effectiveModel.variant } : {}),
    ...(effectiveModel?.profileId ? { profileId: effectiveModel.profileId } : {}),
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
    ...(role ? { agentRole: role } : {}),
    ...(effectiveModel?.providerId ? { providerId: effectiveModel.providerId } : {}),
    ...(effectiveModel?.modelId ? { modelId: effectiveModel.modelId } : {}),
    ...(effectiveModel?.variant ? { variant: effectiveModel.variant } : {}),
    ...(effectiveModel?.profileId ? { profileId: effectiveModel.profileId } : {}),
    ...(typeof durationMs === "number" ? { durationMs } : {}),
    ...(typeof totalTokens === "number" && totalTokens > 0 ? { totalTokens } : {}),
    ...(typeof contextWindow === "number" && contextWindow > 0 ? { contextWindow } : {}),
    ...(typeof outputLimit === "number" && outputLimit > 0 ? { outputLimit } : {}),
  };
};

export const toAssistantMessageMeta = (
  session: AgentSessionState,
  durationMs?: number,
  totalTokens?: number,
  model?: AgentSessionState["selectedModel"],
): Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }> => {
  return createAssistantMessageMeta({
    role: session.role,
    isFinal: true,
    model,
    durationMs,
    totalTokens,
  });
};

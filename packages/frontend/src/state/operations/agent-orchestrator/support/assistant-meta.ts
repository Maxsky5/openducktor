import type {
  AgentChatMessage,
  AgentSessionContextUsage,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { appendSessionMessage, findLastSessionMessage, updateLastSessionMessage } from "./messages";
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

const resolveModelDescriptor = (
  session: AgentSessionState,
  model: AgentSessionState["selectedModel"] | null,
) => {
  if (!model || !session.modelCatalog) {
    return null;
  }
  return (
    session.modelCatalog.models.find(
      (entry) => entry.providerId === model.providerId && entry.modelId === model.modelId,
    ) ?? null
  );
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
  const modelDescriptor = resolveModelDescriptor(session, effectiveModel);

  return {
    totalTokens,
    ...(effectiveModel?.providerId ? { providerId: effectiveModel.providerId } : {}),
    ...(effectiveModel?.modelId ? { modelId: effectiveModel.modelId } : {}),
    ...(effectiveModel?.variant ? { variant: effectiveModel.variant } : {}),
    ...(effectiveModel?.profileId ? { profileId: effectiveModel.profileId } : {}),
    ...(typeof modelDescriptor?.contextWindow === "number"
      ? { contextWindow: modelDescriptor.contextWindow }
      : {}),
    ...(typeof modelDescriptor?.outputLimit === "number"
      ? { outputLimit: modelDescriptor.outputLimit }
      : {}),
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
  const effectiveModel = mergeModelSelection(null, model ?? undefined);
  const selectedModelDescriptor = resolveModelDescriptor(session, effectiveModel);
  return createAssistantMessageMeta({
    role: session.role,
    isFinal: true,
    model,
    durationMs,
    totalTokens,
    contextWindow: selectedModelDescriptor?.contextWindow,
    outputLimit: selectedModelDescriptor?.outputLimit,
  });
};

export const finalizeDraftAssistantMessage = (
  session: AgentSessionState,
  timestamp: string,
  durationMs?: number,
  totalTokens?: number,
  model?: AgentSessionState["selectedModel"],
): AgentSessionState => {
  const draft = session.draftAssistantText.trim();
  const clearedDraftFields = {
    draftAssistantText: "",
    draftAssistantMessageId: null,
    draftReasoningText: "",
    draftReasoningMessageId: null,
  } as const;
  if (draft.length === 0) {
    if (
      session.draftReasoningText.length === 0 &&
      session.draftAssistantMessageId === null &&
      session.draftReasoningMessageId === null
    ) {
      return session;
    }

    return {
      ...session,
      ...clearedDraftFields,
    };
  }

  const lastMessage = findLastSessionMessage(session);
  const alreadyAppended =
    lastMessage?.role === "assistant" &&
    (lastMessage.id === session.draftAssistantMessageId || lastMessage.content.trim() === draft);
  if (alreadyAppended) {
    return {
      ...session,
      ...clearedDraftFields,
      messages: updateLastSessionMessage(session, (existing) =>
        existing.meta?.kind !== "assistant"
          ? {
              ...existing,
              meta: toAssistantMessageMeta(session, durationMs, totalTokens, model),
            }
          : existing,
      ),
    };
  }

  return {
    ...session,
    ...clearedDraftFields,
    messages: appendSessionMessage(session, {
      id: session.draftAssistantMessageId ?? crypto.randomUUID(),
      role: "assistant",
      content: draft,
      timestamp,
      meta: toAssistantMessageMeta(session, durationMs, totalTokens, model),
    }),
  };
};

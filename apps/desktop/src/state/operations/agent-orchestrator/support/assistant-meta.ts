import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { mergeModelSelection } from "./models";

const resolveSelectedModelDescriptor = (session: AgentSessionState) => {
  if (!session.selectedModel || !session.modelCatalog) {
    return null;
  }
  return (
    session.modelCatalog.models.find(
      (entry) =>
        entry.providerId === session.selectedModel?.providerId &&
        entry.modelId === session.selectedModel?.modelId,
    ) ?? null
  );
};

export const toAssistantMessageMeta = (
  session: AgentSessionState,
  durationMs?: number,
  totalTokens?: number,
  model?: AgentSessionState["selectedModel"],
): Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }> => {
  const effectiveModel = mergeModelSelection(session.selectedModel, model ?? undefined);
  const selectedModelDescriptor =
    model === undefined ? resolveSelectedModelDescriptor(session) : null;
  return {
    kind: "assistant",
    agentRole: session.role,
    isFinal: true,
    ...(effectiveModel?.providerId ? { providerId: effectiveModel.providerId } : {}),
    ...(effectiveModel?.modelId ? { modelId: effectiveModel.modelId } : {}),
    ...(effectiveModel?.variant ? { variant: effectiveModel.variant } : {}),
    ...(effectiveModel?.profileId ? { profileId: effectiveModel.profileId } : {}),
    ...(typeof durationMs === "number" ? { durationMs } : {}),
    ...(typeof totalTokens === "number" && totalTokens > 0 ? { totalTokens } : {}),
    ...(typeof selectedModelDescriptor?.contextWindow === "number"
      ? { contextWindow: selectedModelDescriptor.contextWindow }
      : {}),
    ...(typeof selectedModelDescriptor?.outputLimit === "number"
      ? { outputLimit: selectedModelDescriptor.outputLimit }
      : {}),
  };
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

  const lastMessage = session.messages[session.messages.length - 1];
  const alreadyAppended =
    lastMessage?.role === "assistant" &&
    (lastMessage.id === session.draftAssistantMessageId || lastMessage.content.trim() === draft);
  if (alreadyAppended) {
    const nextMessages = [...session.messages];
    const lastIndex = nextMessages.length - 1;
    const existing = nextMessages[lastIndex];
    if (existing && (!existing.meta || existing.meta.kind !== "assistant")) {
      nextMessages[lastIndex] = {
        ...existing,
        meta: toAssistantMessageMeta(session, durationMs, totalTokens, model),
      };
    }
    return {
      ...session,
      ...clearedDraftFields,
      messages: nextMessages,
    };
  }

  return {
    ...session,
    ...clearedDraftFields,
    messages: [
      ...session.messages,
      {
        id: session.draftAssistantMessageId ?? crypto.randomUUID(),
        role: "assistant",
        content: draft,
        timestamp,
        meta: toAssistantMessageMeta(session, durationMs, totalTokens, model),
      },
    ],
  };
};

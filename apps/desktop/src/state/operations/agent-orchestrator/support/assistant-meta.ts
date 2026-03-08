import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";

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
): Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }> => {
  const selectedModelDescriptor = resolveSelectedModelDescriptor(session);
  return {
    kind: "assistant",
    agentRole: session.role,
    ...(session.selectedModel?.providerId ? { providerId: session.selectedModel.providerId } : {}),
    ...(session.selectedModel?.modelId ? { modelId: session.selectedModel.modelId } : {}),
    ...(session.selectedModel?.variant ? { variant: session.selectedModel.variant } : {}),
    ...(session.selectedModel?.profileId ? { profileId: session.selectedModel.profileId } : {}),
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
): AgentSessionState => {
  const draft = session.draftAssistantText.trim();
  if (draft.length === 0) {
    return session;
  }

  const lastMessage = session.messages[session.messages.length - 1];
  const alreadyAppended = lastMessage?.role === "assistant" && lastMessage.content.trim() === draft;
  if (alreadyAppended) {
    const nextMessages = [...session.messages];
    const lastIndex = nextMessages.length - 1;
    const existing = nextMessages[lastIndex];
    if (existing && (!existing.meta || existing.meta.kind !== "assistant")) {
      nextMessages[lastIndex] = {
        ...existing,
        meta: toAssistantMessageMeta(session, durationMs, totalTokens),
      };
    }
    return {
      ...session,
      draftAssistantText: "",
      messages: nextMessages,
    };
  }

  return {
    ...session,
    draftAssistantText: "",
    messages: [
      ...session.messages,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: draft,
        timestamp,
        meta: toAssistantMessageMeta(session, durationMs, totalTokens),
      },
    ],
  };
};

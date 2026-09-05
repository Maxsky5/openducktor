import { settleAgentImageGeneration } from "@openducktor/core";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { updateSessionMessagesByRole } from "./messages";

type ImageOwner = Pick<
  AgentSessionState,
  "externalSessionId" | "messages" | "imageGenerationEnd" | "imageGenerationTurnEnds"
>;

export const settleImageGenerationMessage = (
  message: AgentChatMessage,
  end: AgentSessionState["imageGenerationEnd"],
  turns?: AgentSessionState["imageGenerationTurnEnds"],
): AgentChatMessage => {
  if (message.meta?.kind === "image_generation" && message.meta.turnId) {
    const reason =
      turns && Object.hasOwn(turns, message.meta.turnId) ? turns[message.meta.turnId] : undefined;
    if (reason) {
      const meta = settleAgentImageGeneration(message.meta, reason);
      return meta === message.meta ? message : { ...message, meta };
    }
  }
  if (
    !end ||
    message.meta?.kind !== "image_generation" ||
    Date.parse(message.timestamp) > Date.parse(end.timestamp)
  )
    return message;
  const meta = settleAgentImageGeneration(message.meta, end.reason);
  return meta === message.meta ? message : { ...message, meta };
};

export const settleImageGenerationMessages = (session: ImageOwner): AgentSessionState["messages"] =>
  updateSessionMessagesByRole(session, "assistant", (message) =>
    settleImageGenerationMessage(
      message,
      session.imageGenerationEnd,
      session.imageGenerationTurnEnds,
    ),
  );

export const recordImageGenerationEnd = (
  session: AgentSessionState,
  timestamp: string,
  reason: NonNullable<AgentSessionState["imageGenerationEnd"]>["reason"],
  source: "session" | "image" = "session",
): AgentSessionState => {
  if (source === "session" && session.imageGenerationTurnEnds !== undefined) return session;
  const previous = session.imageGenerationEnd;
  const imageGenerationEnd =
    previous && Date.parse(previous.timestamp) >= Date.parse(timestamp)
      ? previous
      : { timestamp, reason };
  const messages = settleImageGenerationMessages({ ...session, imageGenerationEnd });
  return messages === session.messages && imageGenerationEnd === previous
    ? session
    : { ...session, imageGenerationEnd, messages };
};

export const recordImageGenerationTurnEnd = (
  session: AgentSessionState,
  turnId: string,
  reason: "interrupted" | "turn_ended" | "runtime_failure",
): AgentSessionState => {
  const turns = session.imageGenerationTurnEnds;
  const previous = turns && Object.hasOwn(turns, turnId) ? turns[turnId] : undefined;
  if (previous === reason || previous === "interrupted") return session;
  const imageGenerationTurnEnds = { ...session.imageGenerationTurnEnds, [turnId]: reason };
  return {
    ...session,
    imageGenerationTurnEnds,
    messages: settleImageGenerationMessages({ ...session, imageGenerationTurnEnds }),
  };
};

export const recordImageGenerationSessionEnd = (
  session: AgentSessionState,
  timestamp: string,
  reason: NonNullable<AgentSessionState["imageGenerationEnd"]>["reason"],
): AgentSessionState =>
  recordImageGenerationEnd(
    { ...session, imageGenerationTurnEnds: session.imageGenerationTurnEnds ?? {} },
    timestamp,
    reason,
    "image",
  );

import { settleAgentImageGeneration } from "@openducktor/core";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { updateSessionMessagesByRole } from "./messages";

type ImageOwner = Pick<
  AgentSessionState,
  | "externalSessionId"
  | "messages"
  | "imageGenerationEnd"
  | "imageGenerationTurnEnds"
  | "imageGenerationTurnStarts"
>;

/** Prefer a known turn end to timestamps, which history can only approximate. */
export const settleImageGenerationMessage = (
  message: AgentChatMessage,
  end: AgentSessionState["imageGenerationEnd"],
  turns?: AgentSessionState["imageGenerationTurnEnds"],
  starts?: AgentSessionState["imageGenerationTurnStarts"],
): AgentChatMessage => {
  if (message.meta?.kind === "image_generation" && message.meta.turnId) {
    const reason = turns?.get(message.meta.turnId);
    if (reason) {
      const meta = settleAgentImageGeneration(message.meta, reason);
      return meta === message.meta ? message : { ...message, meta };
    }
    if (starts?.has(message.meta.turnId)) return message;
  }
  if (
    !end ||
    message.meta?.kind !== "image_generation" ||
    (!message.timestampIsApproximate && Date.parse(message.timestamp) > Date.parse(end.timestamp))
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
      session.imageGenerationTurnStarts,
    ),
  );

export const recordImageGenerationEnd = (
  session: AgentSessionState,
  timestamp: string,
  reason: NonNullable<AgentSessionState["imageGenerationEnd"]>["reason"],
  source: "session" | "image" = "session",
): AgentSessionState => {
  // Generic session events lack turn identity and cannot replace image-specific turn ends.
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
  const previous = turns?.get(turnId);
  if (previous === reason || previous === "interrupted") return session;
  const imageGenerationTurnEnds = new Map(session.imageGenerationTurnEnds).set(turnId, reason);
  const imageGenerationTurnStarts = new Set(session.imageGenerationTurnStarts);
  imageGenerationTurnStarts.delete(turnId);
  return {
    ...session,
    imageGenerationTurnEnds,
    imageGenerationTurnStarts,
    messages: settleImageGenerationMessages({ ...session, imageGenerationTurnEnds }),
  };
};

export const recordImageGenerationSessionEnd = (
  session: AgentSessionState,
  timestamp: string,
  reason: NonNullable<AgentSessionState["imageGenerationEnd"]>["reason"],
): AgentSessionState => {
  const imageGenerationTurnEnds = new Map(session.imageGenerationTurnEnds);
  const recordTurn = (turnId: string) => {
    if (imageGenerationTurnEnds.get(turnId) !== "interrupted")
      imageGenerationTurnEnds.set(turnId, reason);
  };
  for (const turnId of session.imageGenerationTurnStarts ?? []) recordTurn(turnId);
  for (const message of session.messages.items) {
    if (message.meta?.kind !== "image_generation" || !message.meta.turnId) continue;
    if (message.timestampIsApproximate || Date.parse(message.timestamp) <= Date.parse(timestamp)) {
      recordTurn(message.meta.turnId);
    }
  }
  return recordImageGenerationEnd(
    { ...session, imageGenerationTurnEnds, imageGenerationTurnStarts: new Set() },
    timestamp,
    reason,
    "image",
  );
};

export const recordImageGenerationTurnStart = (
  session: AgentSessionState,
  turnId: string,
): AgentSessionState => {
  const ends = session.imageGenerationTurnEnds;
  if (ends?.has(turnId) || session.imageGenerationTurnStarts?.has(turnId)) return session;
  return {
    ...session,
    imageGenerationTurnEnds: ends ?? new Map(),
    imageGenerationTurnStarts: new Set(session.imageGenerationTurnStarts).add(turnId),
  };
};

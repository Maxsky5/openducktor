import {
  settleAgentImageGeneration,
  reduceAgentImageGenerationLifecycle,
  resolveAgentImageGenerationSettlement,
  type AgentImageGenerationLifecycle,
} from "@openducktor/core";
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
  if (message.meta?.kind !== "image_generation") return message;
  const reason = resolveAgentImageGenerationSettlement(
    { sessionEnd: end, turnEnds: turns, turnStarts: starts },
    {
      turnId: message.meta.turnId,
      timestamp: message.timestampIsApproximate ? undefined : message.timestamp,
    },
    "session",
  );
  if (!reason) return message;
  const meta = settleAgentImageGeneration(message.meta, reason);
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
  const state = imageLifecycle(session);
  const next = reduceAgentImageGenerationLifecycle(state, { type: "turn_ended", turnId, reason });
  if (next === state) return session;
  const updated = withImageTurns(session, next);
  return { ...updated, messages: settleImageGenerationMessages(updated) };
};

export const recordImageGenerationSessionEnd = (
  session: AgentSessionState,
  timestamp: string,
  reason: NonNullable<AgentSessionState["imageGenerationEnd"]>["reason"],
): AgentSessionState => {
  const turnIds: string[] = [];
  for (const message of session.messages.items) {
    if (message.meta?.kind !== "image_generation" || !message.meta.turnId) continue;
    if (message.timestampIsApproximate || Date.parse(message.timestamp) <= Date.parse(timestamp))
      turnIds.push(message.meta.turnId);
  }
  const next = reduceAgentImageGenerationLifecycle(imageLifecycle(session), {
    type: "session_ended",
    timestamp,
    reason,
    turnIds,
  });
  // Compare session cutoffs separately because older events can arrive after newer ones.
  return recordImageGenerationEnd(withImageTurns(session, next), timestamp, reason, "image");
};

export const recordImageGenerationTurnStart = (
  session: AgentSessionState,
  turnId: string,
): AgentSessionState => {
  const state = imageLifecycle(session);
  const next = reduceAgentImageGenerationLifecycle(state, { type: "turn_started", turnId });
  return next === state ? session : withImageTurns(session, next);
};

const imageLifecycle = (session: ImageOwner): AgentImageGenerationLifecycle => ({
  turnEnds: session.imageGenerationTurnEnds,
  turnStarts: session.imageGenerationTurnStarts,
  sessionEnd: session.imageGenerationEnd,
});

const withImageTurns = (
  session: AgentSessionState,
  lifecycle: Pick<AgentImageGenerationLifecycle, "turnEnds" | "turnStarts">,
): AgentSessionState => {
  const updated = { ...session };
  if (lifecycle.turnEnds) updated.imageGenerationTurnEnds = lifecycle.turnEnds;
  if (lifecycle.turnStarts) updated.imageGenerationTurnStarts = lifecycle.turnStarts;
  return updated;
};

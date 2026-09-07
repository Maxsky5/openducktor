import type { AgentImageGenerationSettlement } from "./agent-image-generation";

export type AgentImageGenerationLifecycle = {
  turnEnds?: ReadonlyMap<string, AgentImageGenerationSettlement> | undefined;
  turnStarts?: ReadonlySet<string> | undefined;
  sessionEnd?: { timestamp: string; reason: AgentImageGenerationSettlement } | undefined;
};

export type AgentImageGenerationLifecycleEvent =
  | { type: "turn_started"; turnId: string }
  | { type: "turn_ended"; turnId: string; reason: AgentImageGenerationSettlement }
  | {
      type: "session_ended";
      timestamp: string;
      reason: AgentImageGenerationSettlement;
      turnIds: Iterable<string>;
    };

/** The caller selects affected turns. Keep a confirmed interruption when later end events arrive. */
export const reduceAgentImageGenerationLifecycle = (
  state: AgentImageGenerationLifecycle,
  event: AgentImageGenerationLifecycleEvent,
): AgentImageGenerationLifecycle => {
  if (event.type === "turn_started") {
    if (state.turnEnds?.has(event.turnId) || state.turnStarts?.has(event.turnId)) return state;
    return {
      ...state,
      turnEnds: state.turnEnds ?? new Map(),
      turnStarts: new Set(state.turnStarts).add(event.turnId),
    };
  }
  if (event.type === "turn_ended") {
    const previous = state.turnEnds?.get(event.turnId);
    if (previous === event.reason || previous === "interrupted") return state;
    const turnStarts = new Set(state.turnStarts);
    turnStarts.delete(event.turnId);
    return {
      ...state,
      turnEnds: new Map(state.turnEnds).set(event.turnId, event.reason),
      turnStarts,
    };
  }
  const turnEnds = new Map(state.turnEnds);
  for (const turnId of [...(state.turnStarts ?? []), ...event.turnIds]) {
    if (turnEnds.get(turnId) !== "interrupted") turnEnds.set(turnId, event.reason);
  }
  return {
    turnEnds,
    turnStarts: new Set(),
    sessionEnd: { timestamp: event.timestamp, reason: event.reason },
  };
};

/** Live runtime items use exact turns. History and frontend messages can also use a session cutoff. */
export const resolveAgentImageGenerationSettlement = (
  state: AgentImageGenerationLifecycle,
  image: { turnId?: string | undefined; timestamp?: string | undefined },
  scope: "turn" | "session",
): AgentImageGenerationSettlement | undefined => {
  if (image.turnId !== undefined) {
    const reason = state.turnEnds?.get(image.turnId);
    if (reason) return reason;
    if (state.turnStarts?.has(image.turnId)) return undefined;
  }
  const end = state.sessionEnd;
  return scope === "session" &&
    end &&
    (image.timestamp === undefined || Date.parse(image.timestamp) <= Date.parse(end.timestamp))
    ? end.reason
    : undefined;
};

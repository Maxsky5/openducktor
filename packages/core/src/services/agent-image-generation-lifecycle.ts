import type { AgentImageGenerationSettlement } from "./agent-image-generation";

export type AgentImageGenerationLifecycle = {
  turnEnds?: ReadonlyMap<string, AgentImageGenerationSettlement> | undefined;
  turnStarts?: ReadonlySet<string> | undefined;
  sessionEnd?: { timestamp: string; reason: AgentImageGenerationSettlement } | undefined;
  sessionFailureTimestamp?: string | undefined;
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

/** The caller selects affected turns. Keep definitive reasons when later idle events arrive. */
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
    const reason = mergeSettlementReason(previous, event.reason);
    if (previous === reason) return state;
    const turnStarts = new Set(state.turnStarts);
    turnStarts.delete(event.turnId);
    return {
      ...state,
      turnEnds: new Map(state.turnEnds).set(event.turnId, reason),
      turnStarts,
    };
  }
  const turnEnds = new Map(state.turnEnds);
  for (const turnId of [...(state.turnStarts ?? []), ...event.turnIds]) {
    turnEnds.set(turnId, mergeSettlementReason(turnEnds.get(turnId), event.reason));
  }
  return {
    turnEnds,
    turnStarts: new Set(),
    sessionEnd: { timestamp: event.timestamp, reason: event.reason },
    sessionFailureTimestamp:
      event.reason === "runtime_failure" ? event.timestamp : state.sessionFailureTimestamp,
  };
};

const mergeSettlementReason = (
  previous: AgentImageGenerationSettlement | undefined,
  incoming: AgentImageGenerationSettlement,
): AgentImageGenerationSettlement =>
  previous === "interrupted" || (previous === "runtime_failure" && incoming === "turn_ended")
    ? previous
    : incoming;

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
  if (
    scope !== "session" ||
    !end ||
    (image.timestamp !== undefined && Date.parse(image.timestamp) > Date.parse(end.timestamp))
  )
    return undefined;
  // Unknown history timestamps use the latest end; only known older images inherit the failure.
  if (
    end.reason === "turn_ended" &&
    image.timestamp !== undefined &&
    state.sessionFailureTimestamp !== undefined &&
    Date.parse(image.timestamp) <= Date.parse(state.sessionFailureTimestamp)
  )
    return "runtime_failure";
  return end.reason;
};

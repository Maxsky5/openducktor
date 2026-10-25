import { BUILTIN_EVENTS, builtinWorkflow, type BuiltinTaskEventId } from "./definition";
import { PLANNING_COMPLETE_GUARD, SPEC_COMPLETE_GUARD } from "./definition-conditions";
import { builtinTaskInput, type BuiltinTask } from "./facts";
import type { BuiltinRoleId, BuiltinSignalId, BuiltinStateId } from "./ids";

export type BuiltinTaskEventDenial = {
  kind: "denied";
  reason: "status" | "planning";
  status: BuiltinStateId;
  allowedStatuses: BuiltinStateId[];
};

/** The Autopilot signal and the source role that a committed transition reports. */
export type BuiltinTransitionCause = { signal?: BuiltinSignalId; sourceRole?: BuiltinRoleId };

export type BuiltinTaskEventDecision =
  | { kind: "unchanged"; status: BuiltinStateId }
  | { kind: "transition"; from: BuiltinStateId; to: BuiltinStateId; cause: BuiltinTransitionCause }
  | BuiltinTaskEventDenial;

const planningGuards = new Set([PLANNING_COMPLETE_GUARD, SPEC_COMPLETE_GUARD]);

export const decideTaskEvent = (
  eventId: BuiltinTaskEventId,
  task: BuiltinTask,
): BuiltinTaskEventDecision => {
  const decision = builtinWorkflow.decide(builtinTaskInput(task), eventId);
  if (decision.kind === "unchanged") return { kind: "unchanged", status: task.status };
  if (decision.kind === "transition") {
    const cause: BuiltinTransitionCause = {};
    if (decision.signal !== undefined) cause.signal = decision.signal;
    if (decision.sourceRole !== undefined) cause.sourceRole = decision.sourceRole;
    return { kind: "transition", from: task.status, to: decision.to, cause };
  }
  return {
    kind: "denied",
    reason:
      decision.reason === "guard" && planningGuards.has(decision.guardId) ? "planning" : "status",
    status: task.status,
    allowedStatuses: allowedStatuses(eventId, task),
  };
};

export const isTaskEventAvailable = (eventId: BuiltinTaskEventId, task: BuiltinTask): boolean =>
  builtinWorkflow.isEventAvailable(builtinTaskInput(task), eventId);

/** Source statuses that admit the event for this task. */
const allowedStatuses = (eventId: BuiltinTaskEventId, task: BuiltinTask): BuiltinStateId[] => {
  const input = builtinTaskInput(task);
  return BUILTIN_EVENTS[eventId].from.filter((state) =>
    builtinWorkflow.isEventAvailable({ ...input, state }, eventId),
  );
};

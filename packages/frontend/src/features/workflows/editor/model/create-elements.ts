import {
  TASK_CLOSED_STATE,
  type WorkflowActionDefinition,
  type WorkflowDocument,
  type WorkflowEventDefinition,
  type WorkflowStateDefinition,
  type WorkflowTone,
} from "@openducktor/contracts";
import { elementKey } from "@openducktor/workflows";
import { elementIds } from "./document-elements";
import type { SharedStateDisplay } from "./editor-derivation";
import {
  appendElement,
  type CreatedElement,
  newId,
  stepOfLaunch,
  updateDefinition,
  updateElement,
  withOptional,
} from "./document-edits";
import { eventSenders } from "./event-senders";

/** The tones that new states take in turn, so board columns are easy to tell apart. */
const NEW_STATE_TONES = [
  "pending",
  "info",
  "review",
  "warning",
  "approval",
] as const satisfies readonly WorkflowTone[];

/** The first tone of `NEW_STATE_TONES` that the fewest states use. */
const nextStateTone = (document: WorkflowDocument): WorkflowTone => {
  const uses = new Map<WorkflowTone, number>();
  for (const { tone } of document.definition.states)
    if (tone) uses.set(tone, (uses.get(tone) ?? 0) + 1);
  let next: WorkflowTone = NEW_STATE_TONES[0];
  for (const tone of NEW_STATE_TONES)
    if ((uses.get(tone) ?? 0) < (uses.get(next) ?? 0)) next = tone;
  return next;
};

/** A state with the display of a shared state. The document holds no undefined field. */
const sharedState = (id: string, shared: SharedStateDisplay): WorkflowStateDefinition => {
  let state: WorkflowStateDefinition = { id, label: shared.label };
  state = withOptional(state, "title", shared.title);
  state = withOptional(state, "shortLabel", shared.shortLabel);
  return withOptional(state, "tone", shared.tone);
};

/**
 * A new state with the next free tone. A state ID that another custom workflow uses takes the
 * display of that state instead, because the board shows both in one column. The state goes
 * after the last other state, so it becomes the last column before `closed`. The editor places
 * its box, and box positions are not saved.
 */
export const addState = (
  document: WorkflowDocument,
  label: string,
  sharedStates: ReadonlyMap<string, SharedStateDisplay> = new Map(),
): CreatedElement => {
  const id = newId(document, "state", label);
  const shared = sharedStates.get(id);
  const state = shared ? sharedState(id, shared) : { id, label, tone: nextStateTone(document) };
  const withState = updateDefinition(document, (definition) => {
    const at = definition.states.findLastIndex((item) => item.id !== TASK_CLOSED_STATE) + 1;
    return {
      ...definition,
      states: [...definition.states.slice(0, at), state, ...definition.states.slice(at)],
    };
  });
  return { document: withState, key: elementKey("state", id) };
};

/**
 * A new event with one source and one outcome. A target equal to the source, or no target, makes
 * an outcome that keeps the state.
 */
export const addEvent = (
  document: WorkflowDocument,
  from: string,
  to: string | null,
  name?: string,
): CreatedElement => {
  const target = to === from ? null : to;
  const targetState = document.definition.states.find((state) => state.id === target);
  // A transition starts with a name, so a big workflow stays readable on the canvas.
  const label = targetState ? `Move to ${targetState.label || targetState.id}` : "New transition";
  // The ID comes from the name, never from a state ID, so a transition ID never looks like a state.
  const id = newId(document, "event", name ?? label);
  const event: WorkflowEventDefinition = {
    id,
    label,
    from: [from],
    guards: [],
    outcomes: [{ when: true, to: target }],
  };
  return { document: appendElement(document, "event", event), key: elementKey("event", id) };
};

/** Which end of a transition line a drag moves. */
export type TransitionEnd = "source" | "target";

/**
 * Moves one end of a transition from one state to another. A new source takes the place of the
 * old one, and a new target replaces the old target in every outcome. A target equal to the only
 * source makes an outcome that keeps the state, as `addEvent` does.
 */
export const reconnectEvent = (
  document: WorkflowDocument,
  eventId: string,
  end: TransitionEnd,
  from: string,
  to: string,
): WorkflowDocument => {
  if (from === to) return document;
  return updateElement(document, "event", eventId, (event) => {
    if (end === "source")
      return {
        ...event,
        from: event.from.includes(to)
          ? event.from.filter((source) => source !== from)
          : event.from.map((source) => (source === from ? to : source)),
      };
    const target = event.from.length === 1 && event.from[0] === to ? null : to;
    return {
      ...event,
      outcomes: event.outcomes.map((outcome) =>
        outcome.to === from ? { ...outcome, to: target } : outcome,
      ),
    };
  });
};

/** The launch actions that a button starts. */
const launchesWithButtons = (document: WorkflowDocument): Set<string> =>
  new Set(
    document.definition.actions.flatMap((action) =>
      action.kind === "event" || action.kind === "session" ? (action.launchActionIds ?? []) : [],
    ),
  );

/**
 * The defaults of a new button: the first transition that nothing sends yet, and the first way to
 * start that no button starts yet. Without a free one, the button names itself, which shows as a
 * problem until the user picks one, so a button never starts with a wrong reference.
 */
const freeButtonTargets = (document: WorkflowDocument, id: string) => {
  const senders = eventSenders(document.definition);
  const started = launchesWithButtons(document);
  return {
    eventId: document.definition.events.find((event) => !senders.has(event.id))?.id ?? id,
    launchId:
      [...elementIds(document, "launchAction")].find((launch) => !started.has(launch)) ?? id,
  };
};

/** A session button with its launch actions. Its step is the step of its first launch action. */
const sessionAction = (
  document: WorkflowDocument,
  shared: Omit<WorkflowActionDefinition, "kind">,
  launchActionIds: [string, ...string[]],
  eventId: string | undefined,
): WorkflowActionDefinition => {
  const { stepId: _stepId, ...rest } = shared;
  const action: WorkflowActionDefinition = { ...rest, kind: "session", launchActionIds };
  if (eventId) action.eventId = eventId;
  return withOptional(action, "stepId", stepOfLaunch(document, launchActionIds[0]));
};

/** A new action. A view or approval action needs no reference. */
export const addAction = (
  document: WorkflowDocument,
  label: string,
  kind: WorkflowActionDefinition["kind"],
): CreatedElement => {
  const id = newId(document, "action", label);
  const common = { id, label, availableWhen: true };
  const { eventId, launchId } = freeButtonTargets(document, id);
  const action: WorkflowActionDefinition =
    kind === "event"
      ? { ...common, kind, eventId }
      : kind === "session"
        ? sessionAction(document, common, [launchId], undefined)
        : { ...common, kind };
  return { document: appendElement(document, "action", action), key: elementKey("action", id) };
};

/** The optional fields that every action kind has. */
const SHARED_ACTION_FIELDS = [
  "labels",
  "description",
  "stepId",
  "surfaces",
  "emphasis",
  "icon",
  "studioLabel",
] as const;

/**
 * The action with another kind. It keeps the shared fields, the transition, and the launch
 * actions, and starts the new fields valid. Only a session button and a view keep a step: a
 * session button takes the step of its first launch action, and a move or an approval has none.
 */
export const withActionKind = (
  document: WorkflowDocument,
  actionId: string,
  kind: WorkflowActionDefinition["kind"],
): WorkflowDocument =>
  updateElement(document, "action", actionId, (action) => {
    if (action.kind === kind) return action;
    const eventId = "eventId" in action ? action.eventId : undefined;
    const launchActionIds = "launchActionIds" in action ? (action.launchActionIds ?? []) : [];
    let shared: Omit<WorkflowActionDefinition, "kind"> = {
      id: action.id,
      label: action.label,
      availableWhen: action.availableWhen,
    };
    for (const key of SHARED_ACTION_FIELDS) shared = withOptional(shared, key, action[key]);
    const free = freeButtonTargets(document, action.id);
    switch (kind) {
      case "event": {
        const { stepId: _stepId, ...rest } = shared;
        const move: WorkflowActionDefinition = { ...rest, kind, eventId: eventId ?? free.eventId };
        return withOptional(
          move,
          "launchActionIds",
          launchActionIds.length > 0 ? launchActionIds : undefined,
        );
      }
      case "session": {
        const [first = free.launchId, ...others] = launchActionIds;
        return sessionAction(document, shared, [first, ...others], eventId);
      }
      case "view":
        return { ...shared, kind };
      case "approval": {
        const { stepId: _stepId, ...rest } = shared;
        return { ...rest, kind };
      }
    }
  });

/**
 * "Move to Fixing". When an action already has that label, "Move from Review to Fixing" names the
 * first source state too. A number ends a label that is still taken.
 */
const boardButtonLabel = (document: WorkflowDocument, event: WorkflowEventDefinition): string => {
  const target = event.outcomes.find(({ to }) => to !== null)?.to;
  const states = document.definition.states;
  const stateLabel = (id: string) => states.find((state) => state.id === id)?.label ?? id;
  const taken = new Set(document.definition.actions.map(({ label }) => label));
  const source = event.from[0];
  const candidates = target
    ? [
        `Move to ${stateLabel(target)}`,
        ...(source ? [`Move from ${stateLabel(source)} to ${stateLabel(target)}`] : []),
      ]
    : [`Send ${event.id}`];
  const free = candidates.find((candidate) => !taken.has(candidate));
  if (free) return free;
  const base = candidates[candidates.length - 1]!;
  let label = base;
  for (let suffix = 2; taken.has(label); suffix += 1) label = `${base} ${suffix}`;
  return label;
};

/**
 * A board button for an event: an event action that sends it, labeled after the target state of
 * the event. The selection stays on the event, so the result is only the document.
 */
export const addBoardButton = (
  document: WorkflowDocument,
  event: WorkflowEventDefinition,
): WorkflowDocument => {
  const label = boardButtonLabel(document, event);
  return appendElement(document, "action", {
    id: newId(document, "action", label),
    label,
    kind: "event",
    eventId: event.id,
    availableWhen: true,
  });
};

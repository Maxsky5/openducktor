import {
  TASK_CLOSED_STATE,
  type WorkflowDocument,
  type WorkflowDocumentDefinition,
  type WorkflowTone,
} from "@openducktor/contracts";
import {
  builtinSharedState,
  elementKey,
  eventsWithSenders,
  parseElementKey,
  type WorkflowElementKey,
  type WorkflowReferenceIndex,
} from "@openducktor/workflows";
import { isCoreState } from "./document-edits";
import { fromAnyState } from "./document-elements";
import { targetsFrom } from "./event-routes";
import { type EventSender, eventSenders } from "./event-senders";

/** The worst problem of an element: errors block publication, warnings do not. */
export type ProblemLevel = "error" | "warning";

export type StateNodeData = {
  readonly stateId: string;
  readonly label: string;
  readonly tone: WorkflowTone;
  /** `open` and `closed`, which every workflow has. */
  readonly core: boolean;
  /** Another workflow uses the state ID, so the boards share its column. */
  readonly shared: boolean;
  readonly problem: ProblemLevel | null;
  /** The first problem of the state, for the tooltip of its marker. */
  readonly problemText: string | null;
};

/**
 * What a link draws: an arrow between two boxes, a loop on a box for outcomes that keep it, or a
 * short entry arrow into a box for a transition from many states.
 */
export type CanvasLinkKind = "arrow" | "loop" | "entry";

/**
 * An event with more sources than this draws one short entry arrow into each target, and not one
 * long arrow from each source, so a busy board stays readable. Its label names the sources that
 * move into the target, or their count.
 */
const MANY_SOURCES = 2;

/**
 * The events that one canvas line draws. The events of an arrow share its source and target. The
 * loops of a box group into one loop, so lines never stack.
 */
export type CanvasLink = {
  readonly id: string;
  readonly kind: CanvasLinkKind;
  /** The box of a loop for a loop. */
  readonly source: string;
  readonly target: string;
  /** The states that the line stands for: the source of an arrow or a loop, or those of an entry. */
  readonly sources: readonly string[];
  readonly eventIds: readonly string[];
  /** The approval button of an entry into Done, which closes the task without a transition. */
  readonly actionId: string | null;
};

export type EventEdgeData = {
  readonly kind: CanvasLinkKind;
  readonly eventIds: readonly string[];
  /** The senders of the only event. A line of several events names their count instead. */
  readonly senders: readonly EventSender[];
  /** The senders of each event, in the order of `eventIds`. */
  readonly sendersByEvent: readonly (readonly EventSender[])[];
  /**
   * The line shows its label. An event that draws several lines labels only the first one, so
   * each transition reads once.
   */
  readonly labelled: boolean;
  /** Something sends each event. An event that nothing sends never moves a task. */
  readonly triggered: boolean;
  /** The name that the user gave the only event of the line, or null. */
  readonly label: string | null;
  /** The only event of the line resets the work before the move. */
  readonly resets: boolean;
  /** The worst problem of the events. */
  readonly problem: ProblemLevel | null;
  /** The source states that an entry stands for, else empty. */
  readonly sourceLabels: readonly string[];
  /** The sources of the entry are every state but its target. */
  readonly fromAnyState: boolean;
  /** The approval button that the line draws, instead of transitions. */
  readonly actionId: string | null;
};

type CanvasNode = { readonly id: string; readonly data: StateNodeData };
export type CanvasEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly data: EventEdgeData;
};
export type CanvasGraph = {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
};

type Definition = Pick<WorkflowDocumentDefinition, "states" | "events" | "actions">;
type EventDefinition = WorkflowDocumentDefinition["events"][number];

/** Whether the canvas draws the event from one source state only. */
const fromManyStates = (event: EventDefinition): boolean => event.from.length > MANY_SOURCES;

/** The states of an approval button: those of its condition, when it lists them. */
const approvalSources = (action: WorkflowDocumentDefinition["actions"][number]): string[] => {
  const when = action.availableWhen;
  return when !== true && when !== false && "stateIn" in when ? when.stateIn : [];
};

/**
 * Where an event moves tasks: the declared sources that move to each declared target, and the
 * sources whose outcome keeps the state. A branch counts only from the states where it can apply.
 */
const eventMoves = (event: EventDefinition, declared: ReadonlySet<string>) => {
  const into = new Map<string, string[]>();
  const stays: string[] = [];
  for (const source of event.from) {
    if (!declared.has(source)) continue;
    for (const target of targetsFrom(event, source)) {
      if (target === null || target === source) stays.push(source);
      else if (declared.has(target)) into.set(target, [...(into.get(target) ?? []), source]);
    }
  }
  return { into, stays };
};

/**
 * The lines of a definition. Each event links each source state to each outcome target that it
 * can reach from there. An outcome without a target keeps the state and draws a loop. An event
 * from more than `MANY_SOURCES` states draws one entry into each target, and its outcome that
 * keeps the state draws no loop. An approval button closes the task, so it draws an entry into
 * Done. Links to a state that the definition does not declare stay off the canvas; the problem
 * list shows them.
 */
export const canvasLinks = (definition: Definition): CanvasLink[] => {
  const declared = new Set(definition.states.map(({ id }) => id));
  const links = new Map<string, CanvasLink & { eventIds: string[] }>();
  const add = (
    source: string,
    target: string,
    eventId: string,
    entrySources?: readonly string[],
  ) => {
    const kind = entrySources ? "entry" : source === target ? "loop" : "arrow";
    // Each transition draws its own line, so a line always names one transition.
    const id = `${kind}\u0000${source}\u0000${target}\u0000${eventId}`;
    const sources = entrySources ?? [source];
    const link = links.get(id);
    if (!link)
      links.set(id, { id, kind, source, target, sources, eventIds: [eventId], actionId: null });
    else if (!link.eventIds.includes(eventId)) link.eventIds.push(eventId);
  };
  for (const event of definition.events) {
    const { into, stays } = eventMoves(event, declared);
    if (fromManyStates(event) && into.size > 0) {
      // An entry stands for the sources that move into its box, so each branch reads true.
      for (const [target, sources] of into) add(target, target, event.id, sources);
      continue;
    }
    for (const [target, sources] of into)
      for (const source of sources) add(source, target, event.id);
    for (const source of stays) add(source, source, event.id);
  }
  if (declared.has(TASK_CLOSED_STATE))
    for (const action of definition.actions)
      if (action.kind === "approval") {
        const id = `entry\u0000${TASK_CLOSED_STATE}\u0000${action.id}`;
        links.set(id, {
          id,
          kind: "entry",
          source: TASK_CLOSED_STATE,
          target: TASK_CLOSED_STATE,
          sources: approvalSources(action),
          eventIds: [],
          actionId: action.id,
        });
      }
  return [...links.values()];
};

/**
 * The arrows that an entry folds: one from each source state of the selected transition or
 * approval button to each of its targets. The canvas draws them only while the selection is on
 * it, so a busy board stays readable and a selection shows every link.
 */
export const foldedLinks = (
  definition: Definition,
  selection: WorkflowElementKey | null,
): CanvasLink[] => {
  if (selection === null) return [];
  const { kind, id } = parseElementKey(selection);
  const declared = new Set(definition.states.map((state) => state.id));
  const fan = (sources: readonly string[], targets: readonly string[], actionId: string | null) =>
    sources.flatMap((source) =>
      targets
        .filter((target) => target !== source && declared.has(source) && declared.has(target))
        .map((target): CanvasLink => ({
          id: `folded\u0000${source}\u0000${target}\u0000${selection}`,
          kind: "arrow",
          source,
          target,
          sources: [source],
          eventIds: kind === "event" ? [id] : [],
          actionId,
        })),
    );
  if (kind === "event") {
    const event = definition.events.find((item) => item.id === id);
    // An event from one or two states draws its arrows already.
    if (!event || !fromManyStates(event)) return [];
    return [...eventMoves(event, declared).into].flatMap(([target, sources]) =>
      fan(sources, [target], null),
    );
  }
  const action = kind === "action" ? definition.actions.find((item) => item.id === id) : undefined;
  return action?.kind === "approval"
    ? fan(approvalSources(action), [TASK_CLOSED_STATE], action.id)
    : [];
};

const worst = (levels: readonly (ProblemLevel | undefined)[]): ProblemLevel | null => {
  if (levels.includes("error")) return "error";
  return levels.includes("warning") ? "warning" : null;
};

/**
 * The entry into Done of an approval button. Its sources are the states where the button shows,
 * when its condition lists them.
 */
const approvalEdge = (
  link: CanvasLink,
  action: WorkflowDocumentDefinition["actions"][number],
  problemLevels: ReadonlyMap<WorkflowElementKey, ProblemLevel>,
  sourcesOf: (
    from: readonly string[],
    targets: readonly string[],
  ) => Pick<EventEdgeData, "sourceLabels" | "fromAnyState">,
): CanvasEdge => {
  const key = elementKey("action", action.id);
  const label = action.label || action.id;
  return {
    id: link.id,
    source: link.source,
    target: link.target,
    data: {
      kind: "entry",
      eventIds: [],
      senders: [{ kind: "action", label, key, icon: action.icon }],
      sendersByEvent: [],
      labelled: true,
      triggered: true,
      label,
      resets: false,
      problem: problemLevels.get(key) ?? null,
      ...sourcesOf(link.sources, [link.target]),
      actionId: action.id,
    },
  };
};

/** The boxes and lines of a document. */
export const deriveCanvasGraph = (
  document: WorkflowDocument,
  problemLevels: ReadonlyMap<WorkflowElementKey, ProblemLevel>,
  sharedStateIds: ReadonlySet<string>,
  /** The problems of each element, so a box tells its first problem on hover. */
  problems: ReadonlyMap<WorkflowElementKey, readonly { readonly message: string }[]> = new Map(),
): CanvasGraph => {
  const definition = document.definition;
  const nodes: CanvasNode[] = definition.states.map((state) => {
    const shown = builtinSharedState(state.id) ?? state;
    return {
      id: state.id,
      data: {
        stateId: state.id,
        label: shown.label || state.id,
        tone: shown.tone ?? "neutral",
        core: isCoreState(state.id),
        shared: sharedStateIds.has(state.id),
        problem: problemLevels.get(elementKey("state", state.id)) ?? null,
        problemText: problems.get(elementKey("state", state.id))?.[0]?.message ?? null,
      },
    };
  });
  const labels = new Map(nodes.map(({ id, data }) => [id, data.label]));
  const events = new Map(definition.events.map((event) => [event.id, event]));
  const senders = eventSenders(definition);
  const triggered = eventsWithSenders(definition);
  const labelledEvents = new Set<string>();
  const actions = new Map(definition.actions.map((action) => [action.id, action]));
  /** The board columns that a list of sources names, and whether they are all a task leaves. */
  const sourcesOf = (from: readonly string[], targets: readonly string[]) => ({
    sourceLabels: from.map((id) => labels.get(id) ?? id),
    fromAnyState: fromAnyState(definition, from, targets),
  });
  const edges = canvasLinks(definition).map((link): CanvasEdge => {
    const approval = link.actionId === null ? undefined : actions.get(link.actionId);
    if (approval) return approvalEdge(link, approval, problemLevels, sourcesOf);
    const only = link.eventIds.length === 1 ? events.get(link.eventIds[0]!) : undefined;
    // An entry stands alone at its box, so each one shows its label.
    const labelled = link.kind === "entry" || only === undefined || !labelledEvents.has(only.id);
    for (const eventId of link.eventIds) labelledEvents.add(eventId);
    return {
      id: link.id,
      source: link.source,
      target: link.target,
      data: {
        kind: link.kind,
        eventIds: link.eventIds,
        senders: only ? (senders.get(only.id) ?? []) : [],
        sendersByEvent: link.eventIds.map((eventId) => senders.get(eventId) ?? []),
        labelled,
        triggered: link.eventIds.every((eventId) => triggered.has(eventId)),
        label: only?.label?.trim() || null,
        resets: only?.effects?.some(({ id }) => id === "worktree.reset") ?? false,
        problem: worst(
          link.eventIds.map((eventId) => problemLevels.get(elementKey("event", eventId))),
        ),
        ...(link.kind === "entry"
          ? sourcesOf(link.sources, [link.target])
          : { sourceLabels: [], fromAnyState: false }),
        actionId: null,
      },
    };
  });
  return { nodes, edges };
};

export type CanvasHighlight = {
  /** Whether a selection decides the highlight. Without one, nothing dims. */
  readonly active: boolean;
  readonly states: ReadonlySet<string>;
  readonly events: ReadonlySet<string>;
};

const NO_HIGHLIGHT: CanvasHighlight = {
  active: false,
  states: new Set(),
  events: new Set(),
};

/** The selections that the canvas shows: its boxes, its lines, and the buttons on its lines. */
const CANVAS_KINDS: ReadonlySet<string> = new Set(["state", "event", "action"]);

/**
 * The states and events that the selection is, names, or that name it. A selection off the
 * canvas, such as the workflow, a role, or a prompt, highlights and dims nothing.
 */
export const canvasHighlight = (
  index: WorkflowReferenceIndex,
  selection: WorkflowElementKey | null,
): CanvasHighlight => {
  if (selection === null || !CANVAS_KINDS.has(parseElementKey(selection).kind)) return NO_HIGHLIGHT;
  const states = new Set<string>();
  const events = new Set<string>();
  const keys = [
    selection,
    ...(index.names.get(selection) ?? []),
    ...(index.namedBy.get(selection) ?? []),
  ];
  for (const key of keys) {
    const { kind, id } = parseElementKey(key);
    if (kind === "state") states.add(id);
    else if (kind === "event") events.add(id);
  }
  return { active: true, states, events };
};

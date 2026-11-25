import {
  type WorkflowDocument,
  type WorkflowDocumentDefinition,
  type WorkflowProblemPath,
} from "@openducktor/contracts";
import {
  elementKey,
  parseElementKey,
  type WorkflowElementKey,
  type WorkflowElementKind,
} from "@openducktor/workflows";
import { eventMovesBySource } from "./event-routes";
import { eventSenders, senderText } from "./event-senders";

/** The element kinds that a definition keeps as a list of items with IDs. */
export const DEFINITION_LISTS = {
  issueType: "issueTypes",
  role: "roles",
  artifact: "artifacts",
  state: "states",
  step: "steps",
  action: "actions",
  event: "events",
  signal: "signals",
  automation: "automations",
} as const;
export type ListElementKind = keyof typeof DEFINITION_LISTS;
type ListField<Kind extends ListElementKind> = (typeof DEFINITION_LISTS)[Kind];
export type ElementOf<Kind extends ListElementKind> =
  WorkflowDocumentDefinition[ListField<Kind>][number];

/** The rule lists of a definition. Each list is one element. */
export const RULE_LISTS = ["actionOrder", "actionPriority", "launchOrder"] as const;
export type RuleListKind = (typeof RULE_LISTS)[number];

const LIST_ELEMENT_KINDS = [
  "issueType",
  "role",
  "artifact",
  "state",
  "step",
  "action",
  "event",
  "signal",
  "automation",
] as const satisfies readonly ListElementKind[];

const LIST_KIND_BY_FIELD = new Map<string, ListElementKind>(
  LIST_ELEMENT_KINDS.map((kind) => [DEFINITION_LISTS[kind], kind]),
);

export const isListElementKind = (kind: WorkflowElementKind): kind is ListElementKind =>
  LIST_ELEMENT_KINDS.some((listKind) => listKind === kind);

export const isRuleListKind = (kind: string): kind is RuleListKind =>
  RULE_LISTS.some((list) => list === kind);

/** The prompts overview. Problems about a missing prompt select it. */
export const PROMPTS_KEY: WorkflowElementKey = elementKey("prompt");
export const WORKFLOW_KEY: WorkflowElementKey = elementKey("workflow");

export const listOf = <Kind extends ListElementKind>(
  definition: WorkflowDocumentDefinition,
  kind: Kind,
): readonly ElementOf<Kind>[] =>
  // SAFETY: DEFINITION_LISTS names the definition list of each kind, so its items are ElementOf<Kind>.
  definition[DEFINITION_LISTS[kind]] as readonly ElementOf<Kind>[];

export const findElement = <Kind extends ListElementKind>(
  definition: WorkflowDocumentDefinition,
  kind: Kind,
  id: string,
): ElementOf<Kind> | undefined => listOf(definition, kind).find((item) => item.id === id);

/** The IDs of one kind. Launch actions and verdicts are unique in their whole scope. */
export const elementIds = (document: WorkflowDocument, kind: WorkflowElementKind): Set<string> => {
  const definition = document.definition;
  if (isListElementKind(kind)) return new Set(listOf(definition, kind).map(({ id }) => id));
  if (kind === "launchAction")
    return new Set(
      definition.steps.flatMap((step) =>
        step.kind === "agent" ? step.launchActions.map(({ id }) => id) : [],
      ),
    );
  if (kind === "prompt") return new Set(document.prompts.map(({ id }) => id));
  return new Set();
};

/** Whether the element that a key names exists in the document. */
export const elementExists = (document: WorkflowDocument, key: WorkflowElementKey): boolean => {
  const { kind, id } = parseElementKey(key);
  if (kind === "workflow" || isRuleListKind(kind)) return true;
  if (kind === "prompt") return id === "" || document.prompts.some((prompt) => prompt.id === id);
  if (isListElementKind(kind)) return findElement(document.definition, kind, id) !== undefined;
  if (kind === "launchAction") return elementIds(document, kind).has(id);
  return false;
};

/** The item at a path part that is a list index, else undefined. */
const itemAt = <Item>(
  items: readonly Item[],
  part: string | number | undefined,
): Item | undefined => (Number.isInteger(part) ? items[Number(part)] : undefined);

/** The element that a problem path names, and the field path inside that element. */
export type ProblemTarget = {
  readonly key: WorkflowElementKey;
  readonly fieldPath: WorkflowProblemPath;
};

/**
 * Maps a problem path of `checkWorkflowDocument` to its element. Paths start at `definition` or
 * `prompts`. A path that names no element item selects the workflow fields or the prompts.
 */
export const problemTarget = (
  document: WorkflowDocument,
  path: WorkflowProblemPath,
): ProblemTarget => {
  const [root, field, index, ...rest] = path;
  if (root === "prompts") {
    const prompt = itemAt(document.prompts, field);
    return prompt
      ? { key: elementKey("prompt", prompt.id), fieldPath: path.slice(2) }
      : { key: PROMPTS_KEY, fieldPath: [] };
  }
  if (root !== "definition" || field === undefined) return { key: WORKFLOW_KEY, fieldPath: [] };
  const name = String(field);
  if (isRuleListKind(name)) return { key: elementKey(name), fieldPath: path.slice(2) };
  const kind = LIST_KIND_BY_FIELD.get(name);
  const item = kind ? itemAt(listOf(document.definition, kind), index) : undefined;
  if (kind && item) return { key: elementKey(kind, item.id), fieldPath: rest };
  return { key: WORKFLOW_KEY, fieldPath: path.slice(1) };
};

const KIND_LABELS = {
  workflow: "Workflow",
  issueType: "Issue type",
  role: "Role",
  artifact: "Artifact",
  verdict: "Verdict",
  state: "State",
  step: "Step",
  launchAction: "Way to start",
  action: "Button",
  event: "Transition",
  signal: "Signal",
  automation: "Automation",
  prompt: "Prompt",
  actionOrder: "Button order",
  actionPriority: "Button priority",
  launchOrder: "Launch order",
} satisfies Record<WorkflowElementKind, string>;

export const elementKindLabel = (kind: WorkflowElementKind): string => KIND_LABELS[kind];

type EventDefinition = WorkflowDocumentDefinition["events"][number];

const stateNamer = (definition: WorkflowDocumentDefinition) => {
  const labels = new Map(definition.states.map(({ id, label }) => [id, label || id]));
  return (id: string) => labels.get(id) ?? id;
};

/**
 * Whether more than two sources hold every state, but the target of a transition with one target.
 * The editor then says "any state" instead of a count. Done counts too, so a transition that a
 * done task cannot take says how many states it leaves. A transition with several targets counts
 * its sources, since its targets are no sources.
 */
export const fromAnyState = (
  definition: Pick<WorkflowDocumentDefinition, "states">,
  from: readonly string[],
  targets: readonly string[],
): boolean => {
  if (from.length <= 2) return false;
  const skipped = new Set(targets.length === 1 ? targets : []);
  const sources = new Set(from);
  return definition.states.every(({ id }) => skipped.has(id) || sources.has(id));
};

/**
 * The route of an event, source first: "Triage → Fixing", "Any state → Spec ready", "3 states →
 * Fixing", or "Stays in Review" for an event whose outcomes all keep the state. Only the sources
 * where a branch moves the task count, as on the canvas. The tooltip of a list row tells when an
 * event can also keep the state.
 */
export const eventRouteLabel = (
  definition: WorkflowDocumentDefinition,
  event: EventDefinition,
): string => {
  const name = stateNamer(definition);
  const moves = eventMovesBySource(event);
  const sourceLabel = (from: readonly string[], targetIds: readonly string[]) => {
    if (fromAnyState(definition, from, targetIds)) return "Any state";
    return from.length > 2 ? `${from.length} states` : from.map(name).join(", ");
  };
  if (moves.size === 0) return `Stays in ${sourceLabel(event.from, []) || "no state"}`;
  const targetIds = [...new Set([...moves.values()].flat())];
  const sources = sourceLabel([...moves.keys()], targetIds);
  return `${sources || "no state"} → ${targetIds.map(name).join(", ")}`;
};

/** "From: Backlog, Triage, Fixing" for a tooltip, or null for up to two sources. */
export const eventSourcesTitle = (
  definition: WorkflowDocumentDefinition,
  event: EventDefinition,
): string | null =>
  event.from.length > 2 ? `From: ${event.from.map(stateNamer(definition)).join(", ")}` : null;

/** The longest trigger name that a line label of the canvas holds without an ellipsis. */
const TRIGGER_NAME_LENGTH = 26;

/**
 * The name that the triggers give a transition without its own name: "Start Spec", "Start Spec or
 * Spec saved" when it fits a line label, else "Start Spec or 2 more", else "Start Spec". The
 * lists and the canvas use it, so a transition reads the same everywhere.
 */
export const triggerName = (triggers: readonly string[]): string | null => {
  const [first, second] = triggers;
  if (first === undefined) return null;
  if (second === undefined) return first;
  const both = `${first} or ${second}`;
  if (triggers.length === 2 && both.length <= TRIGGER_NAME_LENGTH) return both;
  const counted = `${first} or ${triggers.length - 1} more`;
  return counted.length <= TRIGGER_NAME_LENGTH ? counted : first;
};

/** The states where an event can send the task, or "stays" when it keeps the state. */
const targetsText = (definition: WorkflowDocumentDefinition, event: EventDefinition): string => {
  const name = stateNamer(definition);
  const targets = [...new Set(event.outcomes.flatMap(({ to }) => (to === null ? [] : [name(to)])))];
  return targets.length === 0 ? "stays" : targets.join(", ");
};

const triggerNames = (
  definition: WorkflowDocumentDefinition,
  roleLabels: ReadonlyMap<string, string>,
): (string | null)[] => {
  const senders = eventSenders(definition);
  return definition.events.map((event) =>
    triggerName((senders.get(event.id) ?? []).map((sender) => senderText(sender, roleLabels))),
  );
};

/** A name that the user gave wins. Else the triggers name the transition, else its route. */
const baseTitles = (
  definition: WorkflowDocumentDefinition,
  triggers: readonly (string | null)[],
): [string, string][] =>
  definition.events.map((event, index): [string, string] => [
    event.id,
    event.label?.trim() || (triggers[index] ?? eventRouteLabel(definition, event)),
  ]);

/**
 * The name of each event as a row with its route under it, by event ID: its own name, else what
 * triggers it, else its route. The canvas shows the same name. Two rows can read the same, and
 * their routes tell them apart.
 */
export const eventRowNames = (
  definition: WorkflowDocumentDefinition,
  roleLabels: ReadonlyMap<string, string> = new Map(),
): Map<string, string> => new Map(baseTitles(definition, triggerNames(definition, roleLabels)));

/**
 * The name of each event in pickers and messages, by event ID: its row name. Events with the
 * same name add their targets, else their ID, so two events never read the same.
 */
export const eventNames = (
  definition: WorkflowDocumentDefinition,
  roleLabels: ReadonlyMap<string, string> = new Map(),
): Map<string, string> => {
  const unique = (names: readonly [string, string][]) => {
    const uses = new Map<string, number>();
    for (const [, name] of names) uses.set(name, (uses.get(name) ?? 0) + 1);
    return (name: string) => uses.get(name) === 1;
  };
  const triggers = triggerNames(definition, roleLabels);
  const titles = baseTitles(definition, triggers);
  const titleIsUnique = unique(titles);
  // A route already names its targets. Only a trigger title adds them.
  const withTargets = titles.map(([id, title], index): [string, string] =>
    titleIsUnique(title) || triggers[index] === null || definition.events[index]!.label?.trim()
      ? [id, title]
      : [id, `${title} → ${targetsText(definition, definition.events[index]!)}`],
  );
  const nameIsUnique = unique(withTargets);
  return new Map(
    withTargets.map(([id, name]) => [id, nameIsUnique(name) ? name : `${name} · ${id}`]),
  );
};

/** A short name of an element for lists and problem rows. An event names its triggers. */
export const elementName = (
  document: WorkflowDocument,
  key: WorkflowElementKey,
  roleLabels: ReadonlyMap<string, string> = new Map(),
): string => {
  const { kind, id } = parseElementKey(key);
  if (kind === "workflow") return document.definition.label || document.definition.id;
  if (kind === "prompt" && id === "") return "Prompts";
  if (isRuleListKind(kind)) return KIND_LABELS[kind];
  if (kind === "prompt") return document.prompts.find((prompt) => prompt.id === id)?.label || id;
  if (kind === "event") {
    return eventNames(document.definition, roleLabels).get(id) ?? id;
  }
  if (isListElementKind(kind)) {
    const item: { id: string; label?: string } | undefined = findElement(
      document.definition,
      kind,
      id,
    );
    return item?.label || id;
  }
  return id;
};

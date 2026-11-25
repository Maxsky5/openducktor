import type { WorkflowDocumentDefinition } from "@openducktor/contracts";

type EventDefinition = WorkflowDocumentDefinition["events"][number];
type Condition = EventDefinition["outcomes"][number]["when"];

/**
 * Whether a condition holds for a task in a state: yes, no, or maybe when it also reads a fact
 * that the canvas does not know, such as an artifact or the issue type.
 */
const holdsIn = (when: Condition, state: string): "yes" | "no" | "maybe" => {
  if (when === true) return "yes";
  if (when === false) return "no";
  if ("stateIn" in when) return when.stateIn.includes(state) ? "yes" : "no";
  if ("not" in when) {
    const inner = holdsIn(when.not, state);
    return inner === "maybe" ? inner : inner === "yes" ? "no" : "yes";
  }
  if ("all" in when) {
    const parts = when.all.map((part) => holdsIn(part, state));
    if (parts.includes("no")) return "no";
    return parts.every((part) => part === "yes") ? "yes" : "maybe";
  }
  if ("any" in when) {
    const parts = when.any.map((part) => holdsIn(part, state));
    if (parts.includes("yes")) return "yes";
    return parts.every((part) => part === "no") ? "no" : "maybe";
  }
  return "maybe";
};

/**
 * The outcome targets that an event can give from a source state. The first outcome that surely
 * holds wins, so the outcomes after it never apply; an outcome that only may hold keeps the next
 * ones in play. A null target keeps the state.
 */
export const targetsFrom = (event: EventDefinition, source: string): (string | null)[] => {
  const targets: (string | null)[] = [];
  for (const { when, to } of event.outcomes) {
    const holds = holdsIn(when, source);
    if (holds === "no") continue;
    targets.push(to);
    if (holds === "yes") break;
  }
  return targets;
};

/**
 * The sources of an event that move a task to another state, with the targets that they reach.
 * A source whose outcomes all keep the state is not in it.
 */
export const eventMovesBySource = (event: EventDefinition): Map<string, string[]> => {
  const moves = new Map<string, string[]>();
  for (const source of event.from) {
    const targets = targetsFrom(event, source).filter(
      (target): target is string => target !== null && target !== source,
    );
    if (targets.length > 0) moves.set(source, targets);
  }
  return moves;
};

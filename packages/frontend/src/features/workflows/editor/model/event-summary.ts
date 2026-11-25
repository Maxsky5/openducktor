import type { WorkflowDocumentDefinition } from "@openducktor/contracts";
import { type EventSender, eventSenders } from "./event-senders";

type EventDefinition = WorkflowDocumentDefinition["events"][number];

/** "A", "A or B", "A, B, or C". */
const either = (items: readonly string[]): string =>
  items.length <= 2 ? items.join(" or ") : `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;

/** "A", "A and B", "A, B, and C". */
const both = (items: readonly string[]): string =>
  items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;

/** One trigger as the subject of a sentence: "The Start button", "Saving the Spec". */
const subject = (sender: EventSender, roleLabels: ReadonlyMap<string, string>): string => {
  switch (sender.kind) {
    case "action":
      return `the ${sender.label} button`;
    case "agent":
      return `the ${roleLabels.get(sender.label) ?? sender.label} agent`;
    case "save":
      return `saving ${sender.label}`;
    case "verdict":
      return `the result ${sender.label}`;
    case "start":
      return `starting ${sender.label}`;
  }
};

/**
 * What a transition does, in one plain sentence for the top of its details, such as "The Reset
 * button moves the task to Backlog. It first resets the work and starts Builder fresh."
 */
export const eventSummary = (
  definition: WorkflowDocumentDefinition,
  event: EventDefinition,
  roleLabels: ReadonlyMap<string, string>,
): string => {
  const senders = eventSenders(definition).get(event.id) ?? [];
  const names = new Map(definition.states.map(({ id, label }) => [id, label || id]));
  const targets = [
    ...new Set(event.outcomes.flatMap(({ to }) => (to === null ? [] : [names.get(to) ?? to]))),
  ];
  const move =
    targets.length === 0 ? "keeps the task in its state" : `moves the task to ${either(targets)}`;
  const who =
    senders.length === 0 ? "" : either(senders.map((sender) => subject(sender, roleLabels)));
  const first =
    who === ""
      ? `Nothing starts this transition yet. It ${move}.`
      : `${who.charAt(0).toUpperCase()}${who.slice(1)} ${move}.`;
  const reset = event.effects?.find(({ id }) => id === "worktree.reset");
  if (!reset) return first;
  const fresh = reset.clearsSessionsOf.map((id) => roleLabels.get(id) ?? id);
  return fresh.length === 0
    ? `${first} It first resets the work.`
    : `${first} It first resets the work and clears the sessions of ${both(fresh)}.`;
};

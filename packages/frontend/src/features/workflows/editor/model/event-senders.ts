import type { WorkflowDocumentDefinition, WorkflowIcon } from "@openducktor/contracts";
import { elementKey, type WorkflowElementKey } from "@openducktor/workflows";

/** What sends an event: an action, an agent role, an artifact save or verdict, or a step start. */
export type EventSender = {
  readonly kind: "action" | "agent" | "save" | "verdict" | "start";
  /** The label of the sender. An agent sender names its role ID. */
  readonly label: string;
  /** The element that sends the event. Agents send the event from its own fields. */
  readonly key: WorkflowElementKey | null;
  /** The role behind the sender: the agent, the role that writes the artifact, or the step role. */
  readonly role?: string | undefined;
  /** The icon of a button, as the board and the task details show it. */
  readonly icon?: WorkflowIcon | undefined;
};

const add = (senders: Map<string, EventSender[]>, eventId: string, sender: EventSender) => {
  const list = senders.get(eventId);
  if (list) list.push(sender);
  else senders.set(eventId, [sender]);
};

/** The senders of each event, by event ID, in definition order. */
export const eventSenders = (
  definition: WorkflowDocumentDefinition,
): ReadonlyMap<string, readonly EventSender[]> => {
  const senders = new Map<string, EventSender[]>();
  // A session button only checks its event. The start event of its step sends it.
  for (const action of definition.actions)
    if (action.kind === "event")
      add(senders, action.eventId, {
        kind: "action",
        label: action.label || action.id,
        key: elementKey("action", action.id),
        icon: action.icon,
      });
  for (const event of definition.events)
    for (const role of event.agent?.roles ?? [])
      add(senders, event.id, { kind: "agent", label: role, key: null, role });
  // The role that writes an artifact saves it and gives its verdicts.
  const writer = (artifactId: string) =>
    definition.roles.find(({ writes }) => writes.includes(artifactId))?.id;
  for (const artifact of definition.artifacts) {
    const key = elementKey("artifact", artifact.id);
    const role = writer(artifact.id);
    if (artifact.kind === "document") {
      if (artifact.saveEventId)
        add(senders, artifact.saveEventId, {
          kind: "save",
          label: artifact.label || artifact.id,
          key,
          role,
        });
      continue;
    }
    for (const verdict of artifact.verdicts)
      add(senders, verdict.eventId, {
        kind: "verdict",
        label: `${artifact.label || artifact.id}: ${verdict.label || verdict.id}`,
        key,
        role,
      });
  }
  for (const step of definition.steps)
    if (step.kind === "agent" && step.startEventId)
      add(senders, step.startEventId, {
        kind: "start",
        label: step.label || step.id,
        key: elementKey("step", step.id),
        role: step.roleId,
      });
  return senders;
};

/**
 * What a sender does, in plain words: "Start triage" for a board button, "Builder agent" for a
 * role, "Spec saved", "Review: Approved", or "Build starts".
 */
export const senderText = (
  sender: EventSender,
  roleLabels: ReadonlyMap<string, string> = new Map(),
): string => {
  switch (sender.kind) {
    case "action":
      return sender.label;
    case "agent":
      return `${roleLabels.get(sender.label) ?? sender.label} agent`;
    case "save":
      return `${sender.label} saved`;
    case "verdict":
      return sender.label;
    case "start":
      return `${sender.label} starts`;
  }
};

/** The kind of a sender for a screen reader or a tooltip. */
export const SENDER_KIND_TEXT = {
  action: "Board button",
  agent: "Agent",
  save: "Document save",
  verdict: "Review verdict",
  start: "Step start",
} satisfies Record<EventSender["kind"], string>;

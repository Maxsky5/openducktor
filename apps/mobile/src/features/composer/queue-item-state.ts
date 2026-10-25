import type { AgentQueuedMessage, AgentSessionUserMessagePart } from "@openducktor/contracts";
import { userMessagePartsToComposerDraft } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import {
  type QueuedMessageSteerContext,
  queuedMessageSteerBlockedReason,
} from "@openducktor/frontend-core/sessions/send/agent-chat-steering";
import { composerDraftPreview } from "./composer-segments";

/** What one Message Queue card shows and which actions it offers. */
export type QueueItemView = {
  submissionId: string;
  state: AgentQueuedMessage["state"];
  /** The parts of the message, which the card shows as text and reference chips. */
  parts: readonly AgentSessionUserMessagePart[];
  /** The text of the message, with chips as their labels. */
  preview: string;
  attachmentNames: string[];
  /** The delivery label, such as "Queued" or "Delivery unknown". */
  statusLabel: string;
  /** Why this card offers no action now, or null when it offers them. */
  note: string | null;
  isEditing: boolean;
  canSteer: boolean;
  /** Why Steer now is closed, or null when it is open. */
  steerBlockedReason: string | null;
  canEdit: boolean;
  canRemove: boolean;
  /** The last delivery failure of the message. */
  error: string | null;
};

const STATUS_LABELS = {
  queued: "Queued",
  editing: "Editing",
  sending: "Sending…",
  steering: "Steering…",
  acceptance_unknown: "Delivery unknown",
} satisfies Record<AgentQueuedMessage["state"], string>;

export const DELIVERY_UNKNOWN_NOTE =
  "The runtime did not confirm this message. It cannot be sent again or removed until the runtime shows it.";

/**
 * Builds a queue card. Only a queued message takes Steer now, Edit, and Remove. A message on its
 * way shows its state, and a message with an unknown delivery waits for the runtime to show it.
 */
export const buildQueueItemView = (
  entry: AgentQueuedMessage,
  {
    steerContext,
    actionRuns,
    commandsOpen,
  }: {
    steerContext: QueuedMessageSteerContext;
    /** True while a queue action of this message runs. */
    actionRuns: boolean;
    /** False while the host connection cannot take commands. */
    commandsOpen: boolean;
  },
): QueueItemView => {
  const draft = userMessagePartsToComposerDraft(entry.parts);
  const isQueued = entry.state === "queued";
  const idle = isQueued && commandsOpen && !actionRuns;
  const steerBlockedReason = isQueued ? queuedMessageSteerBlockedReason(entry, steerContext) : null;
  return {
    submissionId: entry.submissionId,
    state: entry.state,
    parts: entry.parts,
    preview: composerDraftPreview(draft),
    attachmentNames: (draft.attachments ?? []).map((attachment) => attachment.name),
    statusLabel: STATUS_LABELS[entry.state],
    note: entry.state === "acceptance_unknown" ? DELIVERY_UNKNOWN_NOTE : null,
    isEditing: entry.state === "editing",
    canSteer: idle && steerBlockedReason === null,
    steerBlockedReason,
    canEdit: idle,
    canRemove: idle,
    error: entry.error ?? null,
  };
};

/**
 * What a screen reader reads for a queue card, which is one element: the state and the text of
 * the message, its last delivery failure, and, on an open stack, why it offers no action. A
 * closed stack names the count of queued messages and reads the front card.
 */
export const queueCardLabel = (
  view: QueueItemView,
  { spread, count }: { spread: boolean; count: number },
): string => {
  const summary = [view.preview, ...view.attachmentNames].filter(Boolean).join(", ");
  const base = spread
    ? `${view.statusLabel}: ${summary}`
    : `${count} queued ${count === 1 ? "message" : "messages"}. ${summary}`;
  return [base, view.error ? `Failed: ${view.error}` : null, spread ? view.note : null]
    .filter(Boolean)
    .join(". ");
};

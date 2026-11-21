import { elementKey, type WorkflowElementKey } from "@openducktor/workflows";
import type { ReactFlowState } from "@xyflow/react";
import type { EventEdgeData } from "../model/canvas-graph";
import { LABEL_MAX_WIDTH } from "./label-size";
import { triggerName } from "../model/document-elements";
import { type EventSender, SENDER_KIND_TEXT, senderText } from "../model/event-senders";
import type { CanvasEmphasis } from "./state-node";

/** Below this zoom, the event labels overlap and their text is too small to read. */
export const LABEL_MIN_ZOOM = 0.6;

/**
 * Whether the zoom shows every event label. The value changes only when the zoom crosses
 * `LABEL_MIN_ZOOM`, so a zoom step does not render the edges again.
 */
export const selectZoomShowsLabels = (state: Pick<ReactFlowState, "transform">): boolean =>
  state.transform[2] >= LABEL_MIN_ZOOM;

/**
 * The edges of the selected event keep their labels at any zoom. The edges that a selected state
 * highlights do not, because a busy state relates to most events and their labels overlap.
 */
export const showsEdgeLabel = (zoomShowsLabels: boolean, emphasis: CanvasEmphasis): boolean =>
  zoomShowsLabels || emphasis === "selected";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The longest label text that fits its box without an ellipsis. See `label-size.ts`. */
const LABEL_LENGTH = Math.floor((LABEL_MAX_WIDTH - 56) / 7.6);

/** What triggers a transition, by the rule of the lists, so a line reads as its row. */
const triggerText = (
  senders: readonly EventSender[],
  roleLabels: ReadonlyMap<string, string>,
): string =>
  triggerName(senders.map((sender) => senderText(sender, roleLabels))) ?? "No trigger yet";

/**
 * The sources of an entry, after its name: "from any state", or "from 4 states". Other lines have
 * none. The tooltip names each source.
 */
export const entrySources = (
  data: Pick<EventEdgeData, "kind" | "sourceLabels" | "fromAnyState">,
): string | null => {
  if (data.kind !== "entry" || data.sourceLabels.length === 0) return null;
  if (data.fromAnyState) return "from any state";
  const [only] = data.sourceLabels;
  return data.sourceLabels.length === 1
    ? `from ${only}`
    : `from ${data.sourceLabels.length} states`;
};

/**
 * The one-line label of a line in plain words: what triggers its transition. Several transitions
 * on one line name their triggers when they fit, else their count.
 */
export const edgeLabelText = (
  data: EventEdgeData,
  roleLabels: ReadonlyMap<string, string>,
): string => {
  const count = data.eventIds.length;
  if (count > 1) {
    const triggers = data.sendersByEvent.map((senders) => triggerText(senders, roleLabels));
    const joined = triggers.join(" · ");
    if (joined.length <= LABEL_LENGTH) return joined;
    return plural(count, data.kind === "loop" ? "loop" : "transition");
  }
  // A named transition shows its name. Else its triggers name it. The tooltip names the sources.
  const name =
    data.label ?? (data.triggered ? triggerText(data.senders, roleLabels) : "No trigger yet");
  const sources = entrySources(data);
  return sources === null ? name : `${name} · ${sources}`;
};

/** The tooltip of a line: each transition ID with its source states and what triggers it. */
export const edgeTitle = (data: EventEdgeData, roleLabels: ReadonlyMap<string, string>): string => {
  const lines = data.eventIds.map((eventId, index) => {
    const senders = data.sendersByEvent[index] ?? [];
    const named = senders.map(
      (sender) => `${SENDER_KIND_TEXT[sender.kind]} ${senderText(sender, roleLabels)}`,
    );
    return `Transition ${eventId}: ${named.length > 0 ? named.join(", ") : "no trigger yet"}`;
  });
  const sources = data.sourceLabels.length > 0 ? [`From: ${data.sourceLabels.join(", ")}`] : [];
  const approval =
    data.actionId === null
      ? []
      : [`${data.label}: approves the work. The task then moves to Done.`];
  const reset = data.resets ? ["Resets the work before the move."] : [];
  return [...approval, ...lines, ...sources, ...reset].join("\n");
};

/**
 * The event that a click on a line selects: the first one, or the next one while the selection is
 * already on one of its events, so each click reaches the next grouped transition.
 */
export const nextEventKey = (
  eventIds: readonly string[],
  selection: WorkflowElementKey | null,
): WorkflowElementKey => {
  const at = eventIds.findIndex((eventId) => elementKey("event", eventId) === selection);
  return elementKey("event", eventIds[(at + 1) % eventIds.length]!);
};

/** What a click on a line selects: its approval button, or its next transition. */
export const lineSelection = (
  data: Pick<EventEdgeData, "eventIds" | "actionId">,
  selection: WorkflowElementKey | null,
): WorkflowElementKey =>
  data.actionId === null
    ? nextEventKey(data.eventIds, selection)
    : elementKey("action", data.actionId);

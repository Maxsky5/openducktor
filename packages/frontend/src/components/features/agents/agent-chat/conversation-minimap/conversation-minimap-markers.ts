import type { AgentChatUserMessageAnchor } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { AgentChatTranscriptViewportRows } from "../use-agent-chat-transcript-navigation";
import type { MinimapTick } from "./conversation-minimap-layout";

/** Message indexes of the active section and of the first and last visible sections. */
export type MinimapMarkers = {
  activeMessage: number | null;
  firstVisibleMessage: number | null;
  lastVisibleMessage: number | null;
};

export type MinimapTickState = "rest" | "visible" | "active";

export const EMPTY_MINIMAP_MARKERS: MinimapMarkers = Object.freeze({
  activeMessage: null,
  firstVisibleMessage: null,
  lastVisibleMessage: null,
});

export const readMinimapMarkers = (
  anchors: AgentChatUserMessageAnchor[],
  viewportRows: AgentChatTranscriptViewportRows | null,
): MinimapMarkers => {
  if (!viewportRows) {
    return EMPTY_MINIMAP_MARKERS;
  }

  const lastVisibleMessage = findSectionOfRow(anchors, viewportRows.lastVisibleRow);
  if (lastVisibleMessage === null) {
    return EMPTY_MINIMAP_MARKERS;
  }
  return {
    activeMessage: findSectionOfRow(anchors, viewportRows.activeRow),
    firstVisibleMessage: findSectionOfRow(anchors, viewportRows.firstVisibleRow) ?? 0,
    lastVisibleMessage,
  };
};

export const areMinimapMarkersEqual = (left: MinimapMarkers, right: MinimapMarkers): boolean =>
  left.activeMessage === right.activeMessage &&
  left.firstVisibleMessage === right.firstVisibleMessage &&
  left.lastVisibleMessage === right.lastVisibleMessage;

/** A group tick is active when it holds the active message, and visible when any member is. */
export const readTickState = (tick: MinimapTick, markers: MinimapMarkers): MinimapTickState => {
  const { activeMessage, firstVisibleMessage, lastVisibleMessage } = markers;
  if (
    activeMessage !== null &&
    activeMessage >= tick.firstMessage &&
    activeMessage < tick.endMessage
  ) {
    return "active";
  }
  if (
    firstVisibleMessage !== null &&
    lastVisibleMessage !== null &&
    tick.firstMessage <= lastVisibleMessage &&
    tick.endMessage > firstVisibleMessage
  ) {
    return "visible";
  }
  return "rest";
};

// The section of a row starts at the last user message at or before it. Rows before the first
// user message belong to no section.
function findSectionOfRow(anchors: AgentChatUserMessageAnchor[], row: number): number | null {
  let low = 0;
  let high = anchors.length - 1;
  let section: number | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const anchor = anchors[middle];
    if (anchor && anchor.rowIndex <= row) {
      section = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return section;
}

import { describe, expect, test } from "bun:test";
import { buildMessage } from "@openducktor/frontend-core/test-support/agent-chat-transcript-fixtures";
import type { AgentChatUserMessageAnchor } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import {
  EMPTY_MINIMAP_MARKERS,
  readMinimapMarkers,
  readTickState,
} from "./conversation-minimap-markers";

// User messages at rows 2, 5, and 9. Rows 0 and 1 come before the first user message.
const anchors: AgentChatUserMessageAnchor[] = [2, 5, 9].map((rowIndex) => ({
  rowKey: `row-${rowIndex}`,
  rowIndex,
  message: buildMessage("user", `Message at ${rowIndex}`, { id: `user-${rowIndex}` }),
}));

describe("readMinimapMarkers", () => {
  test("maps the active line and the viewport edges to message sections", () => {
    expect(
      readMinimapMarkers(anchors, { activeRow: 6, firstVisibleRow: 4, lastVisibleRow: 10 }),
    ).toEqual({ activeMessage: 1, firstVisibleMessage: 0, lastVisibleMessage: 2 });
  });

  test("has no active message while the top shows content before the first user message", () => {
    expect(
      readMinimapMarkers(anchors, { activeRow: 1, firstVisibleRow: 0, lastVisibleRow: 3 }),
    ).toEqual({ activeMessage: null, firstVisibleMessage: 0, lastVisibleMessage: 0 });
  });

  test("has no markers while only content before the first user message is visible", () => {
    expect(
      readMinimapMarkers(anchors, { activeRow: 0, firstVisibleRow: 0, lastVisibleRow: 1 }),
    ).toBe(EMPTY_MINIMAP_MARKERS);
    expect(readMinimapMarkers(anchors, null)).toBe(EMPTY_MINIMAP_MARKERS);
  });
});

describe("readTickState", () => {
  const markers = { activeMessage: 3, firstVisibleMessage: 3, lastVisibleMessage: 5 };

  test("marks a group active when it holds the active message", () => {
    expect(readTickState({ firstMessage: 2, endMessage: 4 }, markers)).toBe("active");
  });

  test("marks a group visible when any member is visible", () => {
    expect(readTickState({ firstMessage: 5, endMessage: 7 }, markers)).toBe("visible");
  });

  test("leaves other ticks at rest", () => {
    expect(readTickState({ firstMessage: 0, endMessage: 2 }, markers)).toBe("rest");
    expect(readTickState({ firstMessage: 6, endMessage: 8 }, markers)).toBe("rest");
  });
});

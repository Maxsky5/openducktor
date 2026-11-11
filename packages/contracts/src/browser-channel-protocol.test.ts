import { describe, expect, test } from "bun:test";
import {
  decodeBrowserClientMessage,
  decodeBrowserServerMessage,
  encodeBrowserChannelMessage,
} from "./browser-channel-protocol";

const TAB_ID = "10000000-0000-4000-8000-000000000001";

describe("browser channel messages", () => {
  test("round-trips a client message and a server message", () => {
    const hover = { type: "picker_hover", tabId: TAB_ID, x: 10, y: 20, width: 400 } as const;
    const boxes = { type: "anchor_boxes" as const, tabId: TAB_ID, boxes: [] };

    expect(decodeBrowserClientMessage(encodeBrowserChannelMessage(hover))).toEqual(hover);
    expect(decodeBrowserServerMessage(encodeBrowserChannelMessage(boxes))).toEqual(boxes);
  });

  test("refuses a server message as a client message, and text that is not JSON", () => {
    const boxes = encodeBrowserChannelMessage({ type: "anchor_boxes", tabId: TAB_ID, boxes: [] });

    expect(() => decodeBrowserClientMessage(boxes)).toThrow();
    expect(() => decodeBrowserClientMessage(new TextEncoder().encode("{"))).toThrow();
  });

  test("refuses a message over the size limit", () => {
    const anchors = Array.from({ length: 200 }, (_, index) => ({
      annotationId: `a${index}`,
      number: index + 1,
      selectors: ["x".repeat(4_000)],
    }));

    expect(() => encodeBrowserChannelMessage({ type: "anchors", tabId: TAB_ID, anchors })).toThrow(
      "256 KiB",
    );
  });
});

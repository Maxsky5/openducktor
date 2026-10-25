import { describe, expect, test } from "bun:test";
import { BLOCK_PAGE_CHANNEL, type BlockRenderMessage } from "./block-page-messages";
import {
  decodePageMessage,
  decodePageToAppMessage,
  encodePageMessage,
  pageReadyMessageSchema,
} from "./page-channel";

const render: BlockRenderMessage = {
  type: "block_render",
  id: 1,
  markdown: "$x$",
  theme: "dark",
  colors: {
    background: "#000000",
    label: "#ffffff",
    secondaryLabel: "#ebebf599",
    foreground: "#ffffff",
    code: "#ff637e",
    separator: "#545458a6",
    listNumber: "#62748e",
    listBullet: "#cad5e2",
    tableRule: "#e2e8f0",
    tableHeaderRule: "#cad5e2",
    tint: "#a996ff",
    fill: "#7676803d",
    codeBackground: "#2c2c2e",
    error: "#ff6961",
  },
  variant: "compact",
  fontSize: 14,
  lineHeight: 22,
  italic: true,
  fontScale: 1.2,
};

describe("page channel", () => {
  test("encodes and decodes a valid render message", () => {
    const encoded = encodePageMessage(BLOCK_PAGE_CHANNEL.inbound, render);
    expect(decodePageMessage(BLOCK_PAGE_CHANNEL.inbound, encoded)).toEqual({
      ok: true,
      message: render,
    });
  });

  test("refuses to send an invalid message", () => {
    const colors = { ...render.colors, label: "red; background: url(x)" };
    expect(() => encodePageMessage(BLOCK_PAGE_CHANNEL.inbound, { ...render, colors })).toThrow(
      "An isolated page message is not valid",
    );
  });

  test("decodes the page messages and rejects others", () => {
    expect(
      decodePageMessage(BLOCK_PAGE_CHANNEL.outbound, '{"type":"block_size","height":120}'),
    ).toEqual({
      ok: true,
      message: { type: "block_size", height: 120 },
    });
    expect(decodePageMessage(pageReadyMessageSchema, '{"type":"page_ready"}').ok).toBe(true);
    // A render error names its render message; a page script error names none.
    expect(
      decodePageMessage(BLOCK_PAGE_CHANNEL.outbound, '{"type":"block_error","id":3,"message":"x"}'),
    ).toEqual({ ok: true, message: { type: "block_error", id: 3, message: "x" } });
    expect(
      decodePageMessage(BLOCK_PAGE_CHANNEL.outbound, '{"type":"block_error","message":"x"}').ok,
    ).toBe(true);
    expect(decodePageMessage(BLOCK_PAGE_CHANNEL.outbound, "not json")).toEqual({
      ok: false,
      error: "The message is not JSON.",
    });
    expect(decodePageMessage(BLOCK_PAGE_CHANNEL.outbound, '{"type":"link","url":1}').ok).toBe(
      false,
    );
    expect(
      decodePageMessage(BLOCK_PAGE_CHANNEL.outbound, '{"type":"block_size","height":1,"extra":2}')
        .ok,
    ).toBe(false);
    expect(decodePageMessage(BLOCK_PAGE_CHANNEL.outbound, '{"type":"eval","code":"x"}').ok).toBe(
      false,
    );
  });

  test("tells page_ready from the page channel messages", () => {
    const outbound = BLOCK_PAGE_CHANNEL.outbound;
    expect(decodePageToAppMessage(outbound, '{"type":"page_ready"}')).toEqual({
      ok: true,
      message: { kind: "ready" },
    });
    expect(decodePageToAppMessage(outbound, '{"type":"block_size","height":120}')).toEqual({
      ok: true,
      message: { kind: "message", message: { type: "block_size", height: 120 } },
    });
    expect(decodePageToAppMessage(outbound, "{")).toEqual({
      ok: false,
      error: "The message is not JSON.",
    });
    expect(decodePageToAppMessage(outbound, '{"type":"eval"}').ok).toBe(false);
  });

  test("accepts a PNG picture of a diagram and nothing else as an image", () => {
    const snapshot = (image: string) =>
      JSON.stringify({ type: "block_snapshot", image, x: 0, y: 4, width: 320, height: 240 });
    expect(
      decodePageMessage(BLOCK_PAGE_CHANNEL.outbound, snapshot("data:image/png;base64,iVBOR")).ok,
    ).toBe(true);
    expect(
      decodePageMessage(BLOCK_PAGE_CHANNEL.outbound, snapshot("data:image/svg+xml,<svg/>")).ok,
    ).toBe(false);
    expect(
      decodePageMessage(BLOCK_PAGE_CHANNEL.outbound, snapshot("https://example.com/a.png")).ok,
    ).toBe(false);
  });
});

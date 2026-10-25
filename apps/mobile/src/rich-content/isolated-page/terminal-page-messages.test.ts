import { describe, expect, test } from "bun:test";
import { decodePageMessage, encodePageMessage } from "@/rich-content/isolated-page/page-channel";
import { TERMINAL_PAGE_CHANNEL, type TerminalPageInbound } from "./terminal-page-messages";

const configure: TerminalPageInbound = {
  type: "terminal_configure",
  colors: {
    background: "#010203",
    foreground: "#edeef1",
    cursor: "#edeef1",
    cursorAccent: "#010203",
    selection: "#7db4ff59",
  },
  fontSize: 13,
  platform: "darwin",
  inputEnabled: true,
};

describe("terminal page messages", () => {
  test("round-trips app messages", () => {
    const messages: TerminalPageInbound[] = [
      configure,
      { ...configure, platform: null, inputEnabled: false },
      {
        type: "terminal_output",
        chunks: [{ sequenceStart: 0, sequenceEnd: 3, bytes: "YWJj" }],
      },
      { type: "terminal_snapshot", sequenceEnd: 0 },
      {
        type: "terminal_restore",
        sequenceEnd: 9,
        columns: 80,
        rows: 24,
        precedingJoinState: 0,
        bytes: "YWJj",
      },
      { type: "terminal_key", key: "ArrowUp", ctrl: true, alt: false },
      { type: "terminal_modifiers", ctrl: false, alt: true },
      { type: "terminal_paste", text: "ls -la\n" },
      { type: "terminal_copy_selection" },
      { type: "terminal_focus" },
    ];
    for (const message of messages) {
      const encoded = encodePageMessage(TERMINAL_PAGE_CHANNEL.inbound, message);
      expect(decodePageMessage(TERMINAL_PAGE_CHANNEL.inbound, encoded)).toEqual({
        ok: true,
        message,
      });
    }
  });

  test("refuses invalid app messages before they leave", () => {
    const invalid = [
      { ...configure, colors: { ...configure.colors, background: "black; x: url(y)" } },
      { ...configure, platform: "android" },
      { type: "terminal_output", chunks: [] },
      { type: "terminal_output", chunks: [{ sequenceStart: 4, sequenceEnd: 4, bytes: "YQ==" }] },
      { type: "terminal_key", key: "F1", ctrl: false, alt: false },
      {
        type: "terminal_restore",
        sequenceEnd: 1,
        columns: 0,
        rows: 24,
        precedingJoinState: 0,
        bytes: "YQ==",
      },
      { type: "terminal_paste", text: "" },
    ];
    for (const message of invalid) {
      expect(decodePageMessage(TERMINAL_PAGE_CHANNEL.inbound, JSON.stringify(message)).ok).toBe(
        false,
      );
    }
  });

  test("reads page messages and rejects unknown ones", () => {
    const valid = [
      { type: "terminal_ready", columns: 80, rows: 24 },
      { type: "terminal_hydrated" },
      { type: "terminal_consumed", sequenceEnd: 42 },
      { type: "terminal_input", data: "\r" },
      { type: "terminal_resize", columns: 40, rows: 30 },
      { type: "terminal_selection", hasSelection: true },
      { type: "terminal_copy", text: "output" },
      { type: "terminal_modifiers_consumed" },
      { type: "terminal_error", message: "Terminal output failed: gap" },
      { type: "link", url: "https://example.test" },
    ];
    for (const message of valid) {
      expect(decodePageMessage(TERMINAL_PAGE_CHANNEL.outbound, JSON.stringify(message)).ok).toBe(
        true,
      );
    }
    for (const message of [
      { type: "terminal_input", data: "" },
      { type: "terminal_consumed", sequenceEnd: -1 },
      { type: "terminal_resize", columns: 501, rows: 30 },
      { type: "navigate", url: "https://example.test" },
    ]) {
      expect(decodePageMessage(TERMINAL_PAGE_CHANNEL.outbound, JSON.stringify(message)).ok).toBe(
        false,
      );
    }
  });
});

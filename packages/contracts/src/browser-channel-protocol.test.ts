import { describe, expect, test } from "bun:test";
import {
  decodeBrowserClientMessage,
  decodeBrowserServerMessage,
  encodeBrowserChannelMessage,
} from "./browser-channel-protocol";
import { matchBrowserForwardedShortcut } from "./browser-shortcuts";

const TAB_ID = "10000000-0000-4000-8000-000000000001";

describe("browser channel messages", () => {
  test("round-trips a client message and a server message", () => {
    const clear = { type: "picker_clear", tabId: TAB_ID } as const;
    const selection = {
      type: "picker_selection",
      tabId: TAB_ID,
      selection: [{ nodeRef: "3", box: { x: 1, y: 2, width: 30, height: 40 }, label: "Save" }],
    } as const;

    expect(decodeBrowserClientMessage(encodeBrowserChannelMessage(clear))).toEqual(clear);
    expect(decodeBrowserServerMessage(encodeBrowserChannelMessage(selection))).toEqual(selection);
  });

  test("refuses a server message as a client message, and text that is not JSON", () => {
    const shortcut = encodeBrowserChannelMessage({ type: "shortcut", shortcut: "command_palette" });

    expect(() => decodeBrowserClientMessage(shortcut)).toThrow();
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

describe("forwarded shortcuts", () => {
  const key = (input: Partial<Parameters<typeof matchBrowserForwardedShortcut>[0]>) => ({
    key: "k",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...input,
  });

  test("uses Cmd on macOS and Ctrl elsewhere for the command palette", () => {
    expect(matchBrowserForwardedShortcut(key({ metaKey: true }), "darwin")?.id).toBe(
      "command_palette",
    );
    expect(matchBrowserForwardedShortcut(key({ ctrlKey: true }), "darwin")).toBeNull();
    expect(matchBrowserForwardedShortcut(key({ ctrlKey: true }), "linux")?.id).toBe(
      "command_palette",
    );
  });

  test("uses Ctrl+` for the bottom panel on every platform and ignores other chords", () => {
    expect(matchBrowserForwardedShortcut(key({ key: "`", ctrlKey: true }), "darwin")?.id).toBe(
      "toggle_bottom_panel",
    );
    expect(
      matchBrowserForwardedShortcut(key({ metaKey: true, shiftKey: true }), "darwin"),
    ).toBeNull();
    expect(matchBrowserForwardedShortcut(key({ key: "c", metaKey: true }), "darwin")).toBeNull();
  });
});

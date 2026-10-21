import { describe, expect, test } from "bun:test";
import type { AgentToolData } from "@openducktor/contracts";
import { browserToolScreenshots, browserToolTitle } from "./browser-tool-summary";

const TAB_ID = "6f1c2a8e-3b4d-4e5f-9a6b-7c8d9e0f1a2b";

describe("browser tool titles", () => {
  const titleCases: Array<[string, AgentToolData, string]> = [
    [
      "type",
      { tabId: TAB_ID, ref: "e29", text: "lego fusée", submit: true },
      'Type "lego fusée" and press Enter',
    ],
    ["type", { tabId: TAB_ID, ref: "e3", text: "hello" }, 'Type "hello"'],
    ["select", { tabId: TAB_ID, ref: "e9", values: ["fr", "en"] }, 'Select "fr", "en"'],
    ["click", { tabId: TAB_ID, ref: "e12" }, "Click e12"],
    ["click", { tabId: TAB_ID, ref: "e12", doubleClick: true }, "Double-click e12"],
    ["click", { tabId: TAB_ID, ref: "e12", button: "right" }, "Right-click e12"],
    ["hover", { tabId: TAB_ID, ref: "e7" }, "Hover e7"],
    ["open", { url: "http://localhost:3000/settings" }, "Open http://localhost:3000/settings"],
    ["navigate", { tabId: TAB_ID, url: "https://example.com" }, "Go to https://example.com"],
    ["navigate", { tabId: TAB_ID, action: "back" }, "Go back"],
    ["press", { tabId: TAB_ID, key: "Control+a" }, "Press Control+a"],
    ["scroll", { tabId: TAB_ID, deltaY: 400 }, "Scroll down 400 px"],
    ["scroll", { tabId: TAB_ID, deltaX: -120 }, "Scroll left 120 px"],
    ["scroll", { tabId: TAB_ID, ref: "e40" }, "Scroll to e40"],
    ["screenshot", { tabId: TAB_ID }, "Screenshot page"],
    ["screenshot", { tabId: TAB_ID, ref: "e4" }, "Screenshot e4"],
    ["wait", { tabId: TAB_ID, text: "Saved" }, 'Wait for "Saved"'],
    ["wait", { tabId: TAB_ID }, "Wait for load"],
    ["dialog", { tabId: TAB_ID, accept: true, promptText: "Ada" }, 'Accept dialog with "Ada"'],
    ["dialog", { tabId: TAB_ID, accept: false }, "Dismiss dialog"],
    ["console", { tabId: TAB_ID, levels: ["error", "warning"] }, "Console error, warning"],
    ["snapshot", { tabId: TAB_ID }, "Snapshot"],
    ["close", { tabId: TAB_ID }, "Close tab"],
    ["list", {}, "List tabs"],
  ];

  test.each(titleCases)("titles %s %p as %p", (action, input, title) => {
    expect(browserToolTitle(action, input)).toBe(title);
  });

  test("shows only the images of a result as screenshots", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(
      browserToolScreenshots([
        { kind: "text", text: "Screenshot of the visible page." },
        { kind: "file", file: { downloadUri: png, mime: "image/png" } },
        { kind: "file", file: { uri: "file:///tmp/report.pdf", mime: "application/pdf" } },
      ]),
    ).toEqual([png]);
  });
});

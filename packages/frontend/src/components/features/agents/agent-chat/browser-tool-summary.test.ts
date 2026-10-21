import { describe, expect, test } from "bun:test";
import { type AgentToolData, ODT_BROWSER_TOOL_NAMES } from "@openducktor/contracts";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { readBrowserToolAction } from "./browser-tool-summary";
import { buildToolSummary } from "./tool-summary";

const TAB_ID = "6f1c2a8e-3b4d-4e5f-9a6b-7c8d9e0f1a2b";

const browserToolMeta = (
  tool: string,
  input: AgentToolData,
  overrides: Partial<ToolMeta> = {},
): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool,
  toolType: "workflow",
  status: "completed",
  input,
  output: "Clicked e12 and the page changed.",
  ...overrides,
});

describe("browser tool summaries", () => {
  test("reads the action of every browser tool in each runtime spelling", () => {
    for (const toolName of ODT_BROWSER_TOOL_NAMES) {
      const action = toolName.slice("odt_browser_".length);
      for (const name of [
        toolName,
        `openducktor_${toolName}`,
        `functions.openducktor_${toolName}`,
        `mcp__openducktor__${toolName}`,
      ]) {
        expect(readBrowserToolAction(name)).toBe(action);
      }
    }
    expect(readBrowserToolAction("odt_browser_unknown")).toBeNull();
    expect(readBrowserToolAction("odt_set_spec")).toBeNull();
    expect(readBrowserToolAction("browser_click")).toBeNull();
  });

  const summaryCases: Array<[string, AgentToolData, string]> = [
    ["odt_browser_click", { tabId: TAB_ID, ref: "e12" }, "e12"],
    ["mcp__openducktor__odt_browser_hover", { tabId: TAB_ID, ref: "e7" }, "e7"],
    ["odt_browser_type", { tabId: TAB_ID, ref: "e3", text: "secret password" }, "e3"],
    ["odt_browser_select", { tabId: TAB_ID, ref: "e9", values: ["fr"] }, "e9"],
    [
      "odt_browser_open",
      { url: "http://localhost:3000/settings" },
      "http://localhost:3000/settings",
    ],
    ["odt_browser_navigate", { tabId: TAB_ID, action: "back" }, "back"],
    ["odt_browser_navigate", { tabId: TAB_ID, url: "https://example.com" }, "https://example.com"],
    ["odt_browser_press", { tabId: TAB_ID, key: "Control+a" }, "Control+a"],
    ["odt_browser_scroll", { tabId: TAB_ID, deltaY: 400 }, "page"],
    ["odt_browser_screenshot", { tabId: TAB_ID, ref: "e4" }, "e4"],
    ["odt_browser_wait", { tabId: TAB_ID, text: "Saved" }, '"Saved"'],
    ["odt_browser_wait", { tabId: TAB_ID, load: "networkidle" }, "networkidle"],
    ["odt_browser_wait", { tabId: TAB_ID }, "load"],
    ["odt_browser_dialog", { tabId: TAB_ID, accept: false }, "dismiss"],
    ["odt_browser_console", { tabId: TAB_ID, levels: ["error", "warning"] }, "error, warning"],
    ["openducktor_odt_browser_snapshot", { tabId: TAB_ID }, ""],
    ["odt_browser_list", {}, ""],
  ];

  test.each(summaryCases)("summarizes %s as %p", (tool, input, summary) => {
    expect(buildToolSummary(browserToolMeta(tool, input), "")).toBe(summary);
  });

  test("keeps the error first when a browser action fails", () => {
    expect(
      buildToolSummary(
        browserToolMeta(
          "odt_browser_click",
          { tabId: TAB_ID, ref: "e12" },
          { status: "error", error: "Ref e12 no longer matches the page. Take a new snapshot." },
        ),
        "",
      ),
    ).toBe("Ref e12 no longer matches the page. Take a new snapshot.");
  });
});

import { describe, expect, test } from "bun:test";
import { browserWaitCondition, ODT_BROWSER_TOOL_SCHEMAS } from "./odt-browser-tool-schemas";

const TAB_ID = "6f1c2a8e-3b4d-4e5f-9a6b-7c8d9e0f1a2b";
const waitSchema = ODT_BROWSER_TOOL_SCHEMAS.odt_browser_wait;

describe("odt_browser_wait input", () => {
  test("accepts at most one condition", () => {
    expect(waitSchema.safeParse({ tabId: TAB_ID, text: "Saved" }).success).toBe(true);
    expect(waitSchema.safeParse({ tabId: TAB_ID }).success).toBe(true);
    const both = waitSchema.safeParse({ tabId: TAB_ID, text: "Saved", url: "**/done" });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]?.message).toBe("Give at most one of text, ref, url, or load.");
  });

  test("waits for the named condition, or for the load state without one", () => {
    expect(browserWaitCondition(waitSchema.parse({ tabId: TAB_ID, ref: "e12" }))).toEqual({
      ref: "e12",
    });
    expect(browserWaitCondition(waitSchema.parse({ tabId: TAB_ID, load: "networkidle" }))).toEqual({
      load: "networkidle",
    });
    expect(browserWaitCondition(waitSchema.parse({ tabId: TAB_ID }))).toEqual({ load: "load" });
  });
});

describe("odt_browser_navigate and odt_browser_scroll input", () => {
  test("navigate takes exactly one of url and action", () => {
    const navigate = ODT_BROWSER_TOOL_SCHEMAS.odt_browser_navigate;
    expect(navigate.safeParse({ tabId: TAB_ID, url: "localhost:3000" }).success).toBe(true);
    expect(navigate.safeParse({ tabId: TAB_ID, action: "back" }).success).toBe(true);
    for (const input of [{ tabId: TAB_ID }, { tabId: TAB_ID, url: "a.test", action: "reload" }]) {
      expect(navigate.safeParse(input).error?.issues[0]?.message).toBe(
        "Give either url or action, not both and not neither.",
      );
    }
  });

  test("scroll takes a ref or a distance", () => {
    const scroll = ODT_BROWSER_TOOL_SCHEMAS.odt_browser_scroll;
    expect(scroll.safeParse({ tabId: TAB_ID, ref: "e3" }).success).toBe(true);
    expect(scroll.safeParse({ tabId: TAB_ID, deltaY: 400 }).success).toBe(true);
    expect(scroll.safeParse({ tabId: TAB_ID, deltaX: 0 }).error?.issues[0]?.message).toBe(
      "Give a ref, or deltaX or deltaY.",
    );
  });
});

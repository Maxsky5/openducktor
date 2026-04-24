import { describe, expect, test } from "bun:test";
import { resolveAgentSessionDialogTitle } from "./agent-session-dialog-title";

describe("resolveAgentSessionDialogTitle", () => {
  test("prefers a hydrated session title when one is available", () => {
    expect(resolveAgentSessionDialogTitle("Subagent activity", "Background research")).toBe(
      "Background research",
    );
  });

  test("falls back to the requested title when the session title is empty", () => {
    expect(resolveAgentSessionDialogTitle("Subagent activity", "   ")).toBe("Subagent activity");
    expect(resolveAgentSessionDialogTitle("Subagent activity", null)).toBe("Subagent activity");
  });
});

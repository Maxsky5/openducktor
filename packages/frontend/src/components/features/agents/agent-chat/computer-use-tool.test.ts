import { describe, expect, test } from "bun:test";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import {
  computerUseActionTitle,
  computerUseCode,
  computerUseFailureSummary,
  hasComputerUseDetails,
} from "./computer-use-tool";

const toolMeta = (overrides: Partial<ToolMeta>): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "cua_repl.js",
  toolType: "computer_use",
  status: "completed",
  ...overrides,
});

describe("computer use tool helpers", () => {
  test("normalizes the action title whitespace", () => {
    expect(
      computerUseActionTitle(toolMeta({ input: { title: "  Inspect   the\ttask plan editor  " } })),
    ).toBe("Inspect the task plan editor");
  });

  test("falls back to the reset label for js_reset calls without a title", () => {
    expect(computerUseActionTitle(toolMeta({ tool: "cua_repl.js_reset", input: {} }))).toBe(
      "Reset computer session",
    );
  });

  test("falls back to the generic action label for other calls without a title", () => {
    expect(computerUseActionTitle(toolMeta({ input: {} }))).toBe("Computer action");
    expect(computerUseActionTitle(toolMeta({ input: { title: "   " } }))).toBe("Computer action");
  });

  test("returns the first non-empty line after a leading Script error prefix", () => {
    expect(computerUseFailureSummary("Script error: boom\n\nComputer Use API manual\nline 2")).toBe(
      "boom",
    );
    expect(computerUseFailureSummary("Script error:\nfirst real line\nsecond")).toBe(
      "first real line",
    );
    expect(computerUseFailureSummary(undefined)).toBe("");
    expect(computerUseFailureSummary("Script error:")).toBe("");
  });

  test("returns JavaScript code only for non-reset calls", () => {
    expect(computerUseCode(toolMeta({ input: { code: "await tab.click()" } }))).toBe(
      "await tab.click()",
    );
    expect(
      computerUseCode(
        toolMeta({ tool: "cua_repl.js_reset", input: { code: "await tab.click()" } }),
      ),
    ).toBe("");
    expect(computerUseCode(toolMeta({ input: {} }))).toBe("");
  });

  test("reports details only when the card holds code, output, error, or images", () => {
    expect(hasComputerUseDetails(toolMeta({ input: { title: "Click" } }))).toBe(false);
    expect(hasComputerUseDetails(toolMeta({ input: { code: "1 + 1" } }))).toBe(true);
    expect(hasComputerUseDetails(toolMeta({ output: "done" }))).toBe(true);
    expect(hasComputerUseDetails(toolMeta({ status: "error", error: "boom" }))).toBe(true);
    expect(
      hasComputerUseDetails(toolMeta({ images: [{ mimeType: "image/png", dataBase64: "AAAA" }] })),
    ).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import {
  computerUseActionTitle,
  computerUseCode,
  computerUseFailureSummary,
  hasComputerUseDetails,
} from "./computer-use-tool";
import {
  CODEX_RESULT_BUDGET_BYTES,
  codexTruncatedResultPreview,
} from "./computer-use-tool.test-fixtures";

const toolMeta = (overrides: Partial<ToolMeta>): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "cua_repl.js",
  toolType: "computer_use",
  status: "completed",
  ...overrides,
});

const TRUNCATED_FAILURE_FALLBACK = "Computer action failed. Codex truncated its diagnostics.";

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

  test("uses the original failure line from a Codex-truncated result", () => {
    const preview = codexTruncatedResultPreview(
      `Script error: TypeError: element not found\n\nComputer Use API manual\n${"step: inspect the app state\n".repeat(30_000)}`,
    );

    expect(preview.length).toBeGreaterThan(CODEX_RESULT_BUDGET_BYTES);
    const summary = computerUseFailureSummary(preview);
    expect(summary).toBe("TypeError: element not found");
    expect(summary).not.toContain("Computer Use API manual");
  });

  test("states that Codex truncated diagnostics when the preview has no readable line", () => {
    const preview = `{"content":[{"type":"text","text":"\\\\…510000 chars truncated…tail"}],"structured_content":null,"is_error":true}`;

    expect(computerUseFailureSummary(preview)).toBe(TRUNCATED_FAILURE_FALLBACK);
  });

  test("bounds a failure line without newlines", () => {
    const summary = computerUseFailureSummary("boom ".repeat(5_000));

    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.endsWith("…")).toBe(true);
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

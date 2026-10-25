import { describe, expect, test } from "bun:test";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import {
  buildComputerUsePresentation,
  buildQuestionDetailEntries,
  formatToolInput,
  readToolDetailAvailability,
  readToolFileEdits,
  readRegularToolTiming,
  regularToolLineName,
  resolveRegularToolSummaryText,
  workflowToolStatusLabel,
} from "./agent-chat-tool-presentation";

const meta = (overrides: Partial<ToolMeta> = {}): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "bash",
  toolType: "bash",
  status: "completed",
  ...overrides,
});

describe("tool presentation", () => {
  test("falls back to the failure or cancel text when the summary is empty", () => {
    expect(resolveRegularToolSummaryText(meta({ status: "error", error: "boom" }), "")).not.toBe(
      "",
    );
    expect(
      resolveRegularToolSummaryText(
        meta({ tool: "unknown_tool", toolType: "generic", status: "error" }),
        "",
      ),
    ).toBe("Tool failed");
  });

  test("reads which detail sections a call has", () => {
    expect(readToolDetailAvailability(meta({ input: { command: "ls" }, output: "a" }))).toEqual({
      hasInput: true,
      hasOutput: true,
      hasError: false,
    });
    expect(readToolDetailAvailability(meta({ input: { command: "  " } })).hasInput).toBe(false);
  });

  test("names a pending call with an argument stream as preparing", () => {
    expect(regularToolLineName(meta({ status: "pending", inputStreaming: false }), "bash")).toBe(
      "Preparing bash",
    );
    expect(regularToolLineName(meta({ status: "pending", inputStreaming: true }), "bash")).toBe(
      "Preparing bash",
    );
    expect(regularToolLineName(meta({ status: "pending" }), "bash")).toBe("bash");
  });

  test("shows progress only while the arguments of a pending call stream", () => {
    const at = "2026-02-22T10:21:10.000Z";
    const complete = meta({ status: "pending", inputStreaming: false });
    expect(readRegularToolTiming(complete, at).isActive).toBe(false);
    expect(
      readRegularToolTiming(meta({ status: "pending", inputStreaming: true }), at).isActive,
    ).toBe(true);
  });

  test("labels workflow phases and keeps no label for a completed call", () => {
    expect(workflowToolStatusLabel("executing")).toBe("RUNNING");
    expect(workflowToolStatusLabel("queued")).toBe("PREPARING");
    expect(workflowToolStatusLabel("completed")).toBeNull();
  });

  test("reports file edits without applied changes", () => {
    const edits = readToolFileEdits(
      meta({ tool: "edit", toolType: "file_edit", input: { filePath: "/repo/src/a.ts" } }),
      "/repo",
    );
    expect(edits.edits.map((edit) => edit.filePath)).toEqual(["src/a.ts"]);
    expect(edits.diffUnavailable).toBe(true);
  });

  test("formats input with paths relative to the working directory", () => {
    expect(formatToolInput({ filePath: "/repo/src/a.ts" }, "/repo")).toContain('"src/a.ts"');
  });

  test("keys repeated questions apart", () => {
    expect(buildQuestionDetailEntries(meta({ tool: "question", toolType: "question" }))).toEqual(
      [],
    );
  });

  test("builds the Computer Use summary", () => {
    const presentation = buildComputerUsePresentation(
      meta({
        toolType: "computer_use",
        computerUse: {
          action: "Click",
          images: [{ mimeType: "image/png", dataBase64: "AAAA" }],
        },
      }),
    );
    expect(presentation.actionTitle).toBe("Click");
    expect(presentation.screenshotLabel).toBe("Screenshot");
    expect(presentation.hasDetails).toBe(false);
  });
});

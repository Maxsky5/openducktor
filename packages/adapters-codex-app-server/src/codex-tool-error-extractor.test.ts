import { describe, expect, test } from "bun:test";
import {
  codexDynamicToolDisplayPayload,
  codexDynamicToolErrorFromItem,
} from "./codex-tool-error-extractor";
import { codexDynamicToolCallFixture } from "./test-fixtures/codex-protocol";

describe("Codex dynamic tool error extraction", () => {
  test("extracts errors from the current protocol content items", () => {
    const contentItems = [{ type: "text", text: "Plan update output" }];
    const item = codexDynamicToolCallFixture({
      id: "plan-1",
      tool: "update_plan",
      contentItems,
    });

    expect(codexDynamicToolDisplayPayload(item)).toBe(contentItems);
    expect(codexDynamicToolErrorFromItem(item)).toBeNull();
  });

  test("checks visible content before the protocol failure status", () => {
    const item = codexDynamicToolCallFixture({
      id: "plan-1",
      tool: "update_plan",
      contentItems: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: { message: "Visible content failed" },
          }),
        },
      ],
      success: false,
      status: "failed",
    });

    expect(codexDynamicToolErrorFromItem(item)).toBe("Visible content failed");
  });
});

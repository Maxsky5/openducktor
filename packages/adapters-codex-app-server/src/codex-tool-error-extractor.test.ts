import { describe, expect, test } from "bun:test";
import {
  codexDynamicToolDisplayPayload,
  codexDynamicToolErrorFromItem,
} from "./codex-tool-error-extractor";

describe("Codex dynamic tool error extraction", () => {
  test("keeps display payload selection separate from result error scanning", () => {
    const contentItems = [{ type: "text", text: "Plan update output" }];
    const item = {
      type: "dynamicToolCall",
      contentItems,
      result: {
        ok: false,
        error: { message: "Plan update failed" },
      },
    };

    expect(codexDynamicToolDisplayPayload(item)).toBe(contentItems);
    expect(codexDynamicToolErrorFromItem(item)).toBe("Plan update failed");
  });

  test("checks visible content before result and raw item fallbacks", () => {
    const item = {
      type: "dynamicToolCall",
      contentItems: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: { message: "Visible content failed" },
          }),
        },
      ],
      result: {
        ok: false,
        error: { message: "Result failed" },
      },
      isError: true,
      message: "Raw item failed",
    };

    expect(codexDynamicToolErrorFromItem(item)).toBe("Visible content failed");
  });
});

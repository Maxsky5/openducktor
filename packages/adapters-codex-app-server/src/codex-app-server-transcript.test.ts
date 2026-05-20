import { describe, expect, test } from "bun:test";
import { codexTurnItemsFromThreadRead } from "./codex-app-server-transcript";

describe("Codex App Server transcript parsing", () => {
  test("preserves turn model and reasoning effort from thread reads", () => {
    const items = codexTurnItemsFromThreadRead({
      thread: {
        modelProvider: "openai",
        turns: [
          {
            id: "turn-1",
            status: "completed",
            startedAt: 1_778_112_001,
            completedAt: 1_778_112_031,
            model: "gpt-5",
            reasoningEffort: "high",
            items: [
              {
                id: "message-1",
                type: "agentMessage",
                phase: "final_answer",
                text: "Done",
              },
            ],
          },
        ],
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.model).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });
  });
});

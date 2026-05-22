import { describe, expect, test } from "bun:test";
import { codexTurnItemsFromThreadRead, toCodexUserInput } from "./codex-app-server-transcript";

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

  test("does not invent a provider when thread reads omit provider metadata", () => {
    const items = codexTurnItemsFromThreadRead({
      thread: {
        turns: [
          {
            id: "turn-1",
            status: "completed",
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
    expect(items[0]?.model).toBeUndefined();
  });

  test("rejects non-image attachments because Codex app-server has no document input shape", () => {
    expect(() =>
      toCodexUserInput({
        kind: "attachment",
        attachment: {
          id: "attachment-1",
          path: "/tmp/brief.pdf",
          name: "brief.pdf",
          kind: "pdf",
          mime: "application/pdf",
        },
      }),
    ).toThrow(
      "Codex app-server does not support pdf attachments. Codex user input supports text, file references, and images only.",
    );
  });
});

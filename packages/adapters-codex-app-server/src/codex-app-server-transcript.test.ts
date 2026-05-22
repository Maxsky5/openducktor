import { describe, expect, test } from "bun:test";
import { codexTurnItemsFromThreadRead, toHistoryMessage } from "./codex-app-server-transcript";

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

  test("hydrates local images as attachment display parts", () => {
    const items = codexTurnItemsFromThreadRead({
      thread: {
        turns: [
          {
            id: "turn-1",
            status: "completed",
            startedAt: 1_778_112_001,
            completedAt: 1_778_112_031,
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [
                  {
                    type: "text",
                    text: "Inspect this screenshot",
                    text_elements: [],
                  },
                  {
                    type: "localImage",
                    path: "/tmp/openducktor-local-attachments/Screenshot 2026-05-20.png",
                  },
                  {
                    type: "localImage",
                    path: "/tmp/openducktor-local-attachments/Screenshot 2026-05-20.png",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const message = toHistoryMessage(items[0]?.item, "fallback-id");

    expect(message).toMatchObject({
      role: "user",
      text: "Inspect this screenshot /tmp/openducktor-local-attachments/Screenshot 2026-05-20.png /tmp/openducktor-local-attachments/Screenshot 2026-05-20.png",
      displayParts: [
        { kind: "text", text: "Inspect this screenshot" },
        {
          kind: "attachment",
          attachment: {
            id: "codex-local-image:user-1:1",
            kind: "image",
            name: "Screenshot 2026-05-20.png",
            path: "/tmp/openducktor-local-attachments/Screenshot 2026-05-20.png",
          },
        },
        {
          kind: "attachment",
          attachment: {
            id: "codex-local-image:user-1:2",
            kind: "image",
            name: "Screenshot 2026-05-20.png",
            path: "/tmp/openducktor-local-attachments/Screenshot 2026-05-20.png",
          },
        },
      ],
    });
  });
});

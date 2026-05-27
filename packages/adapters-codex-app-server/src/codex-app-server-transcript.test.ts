import { describe, expect, test } from "bun:test";
import {
  codexTurnItemsFromThreadRead,
  codexUserInputsFromItem,
  toCodexTurnInputList,
  toCodexUserInput,
  toHistoryMessage,
} from "./codex-app-server-transcript";
import { codexUserInputListToText, userInputText } from "./codex-user-input-display";

describe("Codex App Server transcript parsing", () => {
  test("maps skill message parts to structured Codex skill input", () => {
    const skill = {
      id: "/skills/review/SKILL.md",
      name: "review",
      path: "/skills/review/SKILL.md",
    };

    const input = toCodexUserInput({ kind: "skill_mention", skill });
    expect(input).toEqual({ type: "skill", name: "review", path: "/skills/review/SKILL.md" });
    expect(userInputText(input)).toBe("$review");
  });

  test("keeps a text skill marker in Codex turn input for history hydration", () => {
    const skill = {
      id: "/skills/review/SKILL.md",
      name: "review",
      path: "/skills/review/SKILL.md",
    };

    expect(
      toCodexTurnInputList([
        { kind: "text", text: "Use " },
        { kind: "skill_mention", skill },
        { kind: "text", text: " please" },
      ]),
    ).toEqual([
      { type: "text", text: "Use " },
      {
        type: "text",
        text: "$review",
        text_elements: [
          {
            byteRange: { start: 0, end: 7 },
            placeholder: "$review",
          },
        ],
      },
      { type: "skill", name: "review", path: "/skills/review/SKILL.md" },
      { type: "text", text: " please" },
    ]);
  });

  test("uses UTF-8 byte ranges for non-ASCII skill markers in Codex turn input", () => {
    const skill = {
      id: "/skills/review-ja/SKILL.md",
      name: "レビュー",
      path: "/skills/review-ja/SKILL.md",
    };

    expect(toCodexTurnInputList([{ kind: "skill_mention", skill }])).toEqual([
      {
        type: "text",
        text: "$レビュー",
        text_elements: [
          {
            byteRange: { start: 0, end: 13 },
            placeholder: "$レビュー",
          },
        ],
      },
      { type: "skill", name: "レビュー", path: "/skills/review-ja/SKILL.md" },
    ]);
  });

  test("parses Codex skill echoes as structured skill display parts", () => {
    const input = codexUserInputsFromItem({
      id: "user-1",
      type: "userMessage",
      content: [
        { type: "text", text: "Tell me the purpose of " },
        { type: "skill", name: "review", path: "/skills/review/SKILL.md" },
        { type: "text", text: " please" },
      ],
    });

    expect(input).toEqual([
      { type: "text", text: "Tell me the purpose of ", text_elements: [] },
      { type: "skill", name: "review", path: "/skills/review/SKILL.md" },
      { type: "text", text: " please", text_elements: [] },
    ]);

    const message = toHistoryMessage(
      {
        id: "user-1",
        type: "userMessage",
        content: input,
      },
      "fallback-id",
    );

    expect(message).toMatchObject({
      role: "user",
      text: "Tell me the purpose of $review please",
      displayParts: [
        { kind: "text", text: "Tell me the purpose of " },
        {
          kind: "skill_mention",
          skill: {
            id: "/skills/review/SKILL.md",
            name: "review",
            path: "/skills/review/SKILL.md",
          },
        },
        { kind: "text", text: " please" },
      ],
    });
  });

  test("collapses Codex persisted marker plus skill echoes", () => {
    const input = codexUserInputsFromItem({
      id: "user-1",
      type: "userMessage",
      content: [
        {
          type: "text",
          text: "Tell me the purpose of $review",
          text_elements: [
            {
              byteRange: { start: 23, end: 30 },
              placeholder: "$review",
            },
          ],
        },
        { type: "skill", name: "review", path: "/skills/review/SKILL.md" },
        { type: "text", text: " please" },
      ],
    });

    expect(codexUserInputListToText(input)).toBe("Tell me the purpose of $review please");

    const message = toHistoryMessage(
      {
        id: "user-1",
        type: "userMessage",
        content: input,
      },
      "fallback-id",
    );

    expect(message).toMatchObject({
      role: "user",
      text: "Tell me the purpose of $review please",
      displayParts: [
        { kind: "text", text: "Tell me the purpose of " },
        {
          kind: "skill_mention",
          skill: {
            id: "/skills/review/SKILL.md",
            name: "review",
            path: "/skills/review/SKILL.md",
          },
        },
        { kind: "text", text: " please" },
      ],
    });
  });

  test("hydrates Codex text element skill markers in persisted user text", () => {
    const input = codexUserInputsFromItem({
      id: "user-1",
      type: "userMessage",
      content: [
        {
          type: "text",
          text: "Tell me the purpose of $review please",
          text_elements: [
            {
              byteRange: { start: 23, end: 30 },
              placeholder: "$review",
            },
          ],
        },
      ],
    });

    const message = toHistoryMessage(
      {
        id: "user-1",
        type: "userMessage",
        content: input,
      },
      "fallback-id",
    );

    expect(message?.displayParts).toEqual([
      { kind: "text", text: "Tell me the purpose of " },
      {
        kind: "skill_mention",
        skill: {
          id: "$review",
          name: "review",
          path: "$review",
        },
        sourceText: {
          value: "$review",
          start: 23,
          end: 30,
        },
      },
      { kind: "text", text: " please" },
    ]);
  });

  test("hydrates Codex text element offsets after inserted input separators", () => {
    const input = codexUserInputsFromItem({
      id: "user-1",
      type: "userMessage",
      content: [
        { type: "text", text: "Use" },
        {
          type: "text",
          text: "$review now",
          text_elements: [
            {
              byteRange: { start: 0, end: 7 },
              placeholder: "$review",
            },
          ],
        },
        { type: "skill", name: "review", path: "/skills/review/SKILL.md" },
      ],
    });

    const message = toHistoryMessage(
      {
        id: "user-1",
        type: "userMessage",
        content: input,
      },
      "fallback-id",
    );

    expect(message).toMatchObject({
      text: "Use $review now",
      displayParts: [
        { kind: "text", text: "Use" },
        {
          kind: "skill_mention",
          skill: {
            id: "/skills/review/SKILL.md",
            name: "review",
            path: "/skills/review/SKILL.md",
          },
          sourceText: {
            value: "$review",
            start: 4,
            end: 11,
          },
        },
        { kind: "text", text: " now" },
      ],
    });
  });

  test("hydrates same-name Codex skill markers in input order", () => {
    const input = codexUserInputsFromItem({
      id: "user-1",
      type: "userMessage",
      content: [
        {
          type: "text",
          text: "$review then $review",
          text_elements: [
            {
              byteRange: { start: 0, end: 7 },
              placeholder: "$review",
            },
            {
              byteRange: { start: 13, end: 20 },
              placeholder: "$review",
            },
          ],
        },
        { type: "skill", name: "review", path: "/global/review/SKILL.md" },
        { type: "skill", name: "review", path: "/repo/review/SKILL.md" },
      ],
    });

    const message = toHistoryMessage(
      {
        id: "user-1",
        type: "userMessage",
        content: input,
      },
      "fallback-id",
    );

    expect(message).toMatchObject({
      text: "$review then $review",
      displayParts: [
        {
          kind: "skill_mention",
          skill: {
            id: "/global/review/SKILL.md",
            path: "/global/review/SKILL.md",
          },
        },
        { kind: "text", text: " then " },
        {
          kind: "skill_mention",
          skill: {
            id: "/repo/review/SKILL.md",
            path: "/repo/review/SKILL.md",
          },
        },
      ],
    });
  });

  test("hydrates non-ASCII Codex text element byte ranges", () => {
    const input = codexUserInputsFromItem({
      id: "user-1",
      type: "userMessage",
      content: [
        {
          type: "text",
          text: "Use $レビュー please",
          text_elements: [
            {
              byteRange: { start: 4, end: 17 },
            },
          ],
        },
        { type: "skill", name: "レビュー", path: "/skills/review-ja/SKILL.md" },
      ],
    });

    const message = toHistoryMessage(
      {
        id: "user-1",
        type: "userMessage",
        content: input,
      },
      "fallback-id",
    );

    expect(message).toMatchObject({
      text: "Use $レビュー please",
      displayParts: [
        { kind: "text", text: "Use " },
        {
          kind: "skill_mention",
          skill: {
            id: "/skills/review-ja/SKILL.md",
            name: "レビュー",
            path: "/skills/review-ja/SKILL.md",
          },
          sourceText: {
            value: "$レビュー",
            start: 4,
            end: 9,
          },
        },
        { kind: "text", text: " please" },
      ],
    });
  });

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
                    path: "/tmp/openducktor-local-attachments/550e8400-e29b-41d4-a716-446655440000-Screenshot 2026-05-20.png",
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
      text: "Inspect this screenshot /tmp/openducktor-local-attachments/550e8400-e29b-41d4-a716-446655440000-Screenshot 2026-05-20.png /tmp/openducktor-local-attachments/Screenshot 2026-05-20.png",
      displayParts: [
        { kind: "text", text: "Inspect this screenshot" },
        {
          kind: "attachment",
          attachment: {
            id: "codex-local-image:user-1:1",
            kind: "image",
            name: "Screenshot 2026-05-20.png",
            path: "/tmp/openducktor-local-attachments/550e8400-e29b-41d4-a716-446655440000-Screenshot 2026-05-20.png",
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

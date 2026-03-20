import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { annotateQuestionToolMessage } from "./question-messages";

describe("agent-orchestrator-question-messages", () => {
  test("annotates latest compatible question tool message", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "tool-older",
        role: "tool",
        content: "Older question",
        timestamp: "2026-02-22T08:00:00.000Z",
        meta: {
          kind: "tool",
          partId: "p1",
          callId: "c1",
          tool: "question",
          status: "completed",
          metadata: {
            requestId: "question-older",
          },
        },
      },
      {
        id: "tool-latest",
        role: "tool",
        content: "Latest question",
        timestamp: "2026-02-22T08:00:01.000Z",
        meta: {
          kind: "tool",
          partId: "p2",
          callId: "c2",
          tool: "ask_question",
          status: "completed",
          metadata: {},
        },
      },
    ];

    const next = annotateQuestionToolMessage(
      messages,
      "question-1",
      [
        {
          header: "Confirm",
          question: "Confirm",
          options: [],
          multiple: false,
          custom: false,
          answers: ["yes"],
        },
      ],
      [["yes"]],
    );

    const latest = next[1];
    if (!latest || latest.meta?.kind !== "tool") {
      throw new Error("Expected tool meta on latest message");
    }
    expect(latest.meta.metadata?.requestId).toBe("question-1");
    expect((latest.meta.metadata?.answers as string[][] | undefined)?.[0]?.[0]).toBe("yes");
  });

  test("does not overwrite mismatched question metadata request id", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "tool-locked",
        role: "tool",
        content: "Locked question",
        timestamp: "2026-02-22T08:00:01.000Z",
        meta: {
          kind: "tool",
          partId: "p2",
          callId: "c2",
          tool: "question",
          status: "completed",
          metadata: {
            requestId: "other-request",
          },
        },
      },
    ];

    const next = annotateQuestionToolMessage(
      messages,
      "question-1",
      [
        {
          header: "Confirm",
          question: "Confirm",
          options: [],
          multiple: false,
          custom: false,
          answers: ["yes"],
        },
      ],
      [["yes"]],
    );

    const first = next[0];
    if (!first || first.meta?.kind !== "tool") {
      throw new Error("Expected tool meta on first message");
    }
    expect(first.meta.metadata?.requestId).toBe("other-request");
    expect(first.meta.metadata?.answers).toBeUndefined();
  });

  test("ignores unrelated tools whose names only contain question as a substring", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "tool-non-question",
        role: "tool",
        content: "Indexing docs",
        timestamp: "2026-02-22T08:00:01.000Z",
        meta: {
          kind: "tool",
          partId: "p3",
          callId: "c3",
          tool: "frequently_asked_questions_lookup",
          status: "completed",
          metadata: {},
        },
      },
    ];

    const next = annotateQuestionToolMessage(
      messages,
      "question-1",
      [
        {
          header: "Confirm",
          question: "Confirm",
          options: [],
          multiple: false,
          custom: false,
          answers: ["yes"],
        },
      ],
      [["yes"]],
    );

    const first = next[0];
    if (!first || first.meta?.kind !== "tool") {
      throw new Error("Expected tool meta on first message");
    }
    expect(first.meta.metadata?.requestId).toBeUndefined();
    expect(first.meta.metadata?.answers).toBeUndefined();
  });
});

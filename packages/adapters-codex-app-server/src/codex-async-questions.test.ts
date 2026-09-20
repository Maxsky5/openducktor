import { describe, expect, test } from "bun:test";
import {
  CodexAsyncQuestionState,
  codexAsyncQuestionItemId,
  encodeCodexAsyncQuestionReplies,
  parseCodexAsyncQuestionItem,
  parseCodexAsyncQuestionReplies,
  parseCodexAsyncQuestionReplyInputs,
  parseCodexAsyncQuestionSkipIds,
  stripCodexAsyncQuestionSkipMarker,
} from "./codex-async-questions";
import { toCodexTurnInputList } from "./codex-user-inputs";

const request = {
  requestId: "call-1",
  blocking: false,
  questions: [
    {
      header: "",
      question: "Which environment?",
      options: [
        { label: "Staging", description: "" },
        { label: "Production", description: "" },
      ],
    },
  ],
};

describe("Codex background questions", () => {
  test("maps a Codex async message to a normal non-blocking request", () => {
    expect(
      parseCodexAsyncQuestionItem({
        type: "agentMessage",
        id: "call-1",
        text: "Which environment?",
        phase: "final_answer",
        memoryCitation: null,
        delivery: "async",
        questions: [{ title: "Which environment?", options: ["Staging", "Production"] }],
      }),
    ).toEqual({ kind: "question", request });
  });

  test("keeps non-question async messages as normal assistant messages", () => {
    expect(
      parseCodexAsyncQuestionItem({
        type: "agentMessage",
        id: "message-1",
        text: "Work continues",
        phase: "commentary",
        memoryCitation: null,
        delivery: "async",
        questions: null,
      }),
    ).toEqual({ kind: "not_async_question" });
  });

  test("rejects malformed question lists", () => {
    expect(
      parseCodexAsyncQuestionItem({
        type: "agentMessage",
        id: "call-invalid",
        text: "Which environment?",
        phase: "commentary",
        memoryCitation: null,
        delivery: "async",
        questions: [],
      }),
    ).toEqual({
      kind: "invalid",
      error:
        "OpenDucktor could not open this structured question. Answer through the main chat composer.",
    });
  });

  test("round-trips native Codex reply envelopes", () => {
    const reply = {
      questionItemId: codexAsyncQuestionItemId("call-1", 0),
      question: "Which environment?",
      answer: "Staging",
    };
    const encoded = encodeCodexAsyncQuestionReplies([reply]);

    expect(parseCodexAsyncQuestionReplies(encoded)).toEqual([reply]);
    expect(
      parseCodexAsyncQuestionReplyInputs([
        { type: "skill", name: "review", path: "/skills/review" },
        { type: "text", text: encoded, text_elements: [] },
      ]),
    ).toEqual([reply]);
    expect(parseCodexAsyncQuestionReplies(`${encoded} trailing`)).toBeNull();
  });

  test("stores resolved request IDs without changing visible text", () => {
    const inputs = toCodexTurnInputList([{ kind: "text", text: "Continue" }], ["call-1"]);

    expect(parseCodexAsyncQuestionSkipIds(inputs)).toEqual(["call-1"]);
    expect(stripCodexAsyncQuestionSkipMarker(inputs)).toEqual([
      { type: "text", text: "Continue", text_elements: [] },
    ]);
  });

  test("builds native replies from normal question answers", () => {
    const state = new CodexAsyncQuestionState();
    state.add("runtime", "thread", request);

    expect(state.repliesForSession("runtime", "thread", "call-1", [["Staging"]])).toEqual([
      {
        questionItemId: codexAsyncQuestionItemId("call-1", 0),
        question: "Which environment?",
        answer: "Staging",
      },
    ]);

    state.resolve("runtime", "thread", ["call-1"]);
    state.add("runtime", "thread", request);
    expect(state.pendingForSession("runtime", "thread")).toEqual([]);
  });
});

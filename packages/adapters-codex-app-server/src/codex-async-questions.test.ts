import { describe, expect, test } from "bun:test";
import {
  CodexAsyncQuestionState,
  codexAsyncQuestionItemId,
  encodeCodexAsyncQuestionReply,
  parseCodexAsyncQuestionItem,
  parseCodexAsyncQuestionReplies,
} from "./codex-async-questions";
import { createCodexAcceptedUserMessage } from "./codex-app-server-streaming";
import { toCodexTurnInputList } from "./codex-user-inputs";

describe("Codex asynchronous questions", () => {
  test("parses source questions and creates stable IDs", () => {
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
    ).toEqual({
      kind: "questions",
      questions: [
        {
          questionItemId: codexAsyncQuestionItemId("call-1", 0),
          sourceMessageId: "call-1",
          questionIndex: 0,
          title: "Which environment?",
          options: ["Staging", "Production"],
        },
      ],
    });
  });

  test.each([
    ["missing questions", undefined],
    ["null questions", null],
    ["empty questions", []],
  ])("classifies async items with %s as invalid", (_label, questions) => {
    const item: Parameters<typeof parseCodexAsyncQuestionItem>[0] = {
      type: "agentMessage",
      id: "call-invalid",
      text: "",
      phase: "commentary",
      memoryCitation: null,
      delivery: "async",
      questions,
    };
    if (questions === undefined) delete item.questions;

    expect(parseCodexAsyncQuestionItem(item)).toEqual({
      kind: "invalid",
      error:
        "OpenDucktor could not open this structured question. Answer through the main chat composer.",
    });
  });

  test("round-trips only complete contextual reply envelopes", () => {
    const reply = { questionItemId: "question-1", question: "Which?", answer: "Staging" };
    expect(parseCodexAsyncQuestionReplies(encodeCodexAsyncQuestionReply(reply))).toEqual([reply]);
    expect(
      parseCodexAsyncQuestionReplies(`${encodeCodexAsyncQuestionReply(reply)} trailing`),
    ).toBeNull();
  });

  test("does not reopen handled questions", () => {
    const state = new CodexAsyncQuestionState();
    const question = {
      questionItemId: codexAsyncQuestionItemId("call-1", 0),
      sourceMessageId: "call-1",
      questionIndex: 0,
      title: "Which?",
      options: null,
    };
    state.add("runtime", "thread", [question]);
    state.resolve("runtime", "thread", [question.questionItemId]);
    state.add("runtime", "thread", [question]);
    expect(state.pendingForSession("runtime", "thread")).toEqual([]);
  });

  test("reports authority only after the tracker knows the full pending baseline", () => {
    const state = new CodexAsyncQuestionState();
    const question = {
      questionItemId: codexAsyncQuestionItemId("call-live", 0),
      sourceMessageId: "call-live",
      questionIndex: 0,
      title: "Which region?",
      options: null,
    };

    state.add("runtime", "resumed-thread", [question]);
    expect(state.isAuthoritative("runtime", "resumed-thread")).toBe(false);

    state.skipPending("runtime", "resumed-thread");
    expect(state.isAuthoritative("runtime", "resumed-thread")).toBe(true);

    state.initializeFreshSession("runtime", "fresh-thread");
    state.add("runtime", "fresh-thread", [question]);
    expect(state.isAuthoritative("runtime", "fresh-thread")).toBe(true);
  });

  test("encodes an accepted answer through normal Codex user input", () => {
    const part = {
      kind: "async_question_reply" as const,
      questionItemId: codexAsyncQuestionItemId("call-1", 0),
      question: "Which environment?",
      answer: " Staging ",
    };
    const inputs = toCodexTurnInputList([part]);
    expect(inputs).toEqual([
      {
        type: "text",
        text: encodeCodexAsyncQuestionReply({
          questionItemId: part.questionItemId,
          question: part.question,
          answer: "Staging",
        }),
        text_elements: [],
      },
    ]);

    expect(
      createCodexAcceptedUserMessage({
        session: {
          runtimeId: "runtime-1",
          repoPath: "/repo",
          threadId: "thread-1",
          workingDirectory: "/repo",
          summary: {
            externalSessionId: "thread-1",
            runtimeKind: "codex",
            workingDirectory: "/repo",
            startedAt: "2026-09-19T10:00:00.000Z",
            status: "running",
            sessionAssociation: { kind: "repository" },
            selectedModel: null,
          },
          model: null,
          liveStatus: { classification: "running" },
        },
        parts: [part],
        model: undefined,
        asyncQuestionItemIds: [part.questionItemId],
      }),
    ).toMatchObject({
      type: "user_message",
      message: "> Which environment?\n\nStaging",
      parts: [{ kind: "text", text: "> Which environment?\n\nStaging" }],
      asyncQuestionReplies: [
        {
          questionItemId: part.questionItemId,
          question: "Which environment?",
          answer: "Staging",
        },
      ],
    });
  });
});

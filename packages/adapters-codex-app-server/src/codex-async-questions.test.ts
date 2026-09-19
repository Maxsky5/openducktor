import { describe, expect, test } from "bun:test";
import {
  CodexAsyncQuestionState,
  codexAsyncQuestionItemId,
  encodeCodexAsyncQuestionReply,
  parseCodexAsyncQuestionItem,
  parseCodexAsyncQuestionReplyInputs,
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
  ])("treats async messages with %s as plain assistant messages", (_label, questions) => {
    const item: Parameters<typeof parseCodexAsyncQuestionItem>[0] = {
      type: "agentMessage",
      id: "message-async",
      text: "Work continues",
      phase: "commentary",
      memoryCitation: null,
      delivery: "async",
      questions,
    };
    if (questions === undefined) delete item.questions;

    expect(parseCodexAsyncQuestionItem(item)).toEqual({ kind: "not_async_question" });
  });

  test.each([
    ["an empty question list", []],
    ["an empty option list", [{ title: "Which environment?", options: [] }]],
  ])("classifies %s as invalid", (_label, questions) => {
    expect(
      parseCodexAsyncQuestionItem({
        type: "agentMessage",
        id: "call-invalid",
        text: "Which environment?",
        phase: "commentary",
        memoryCitation: null,
        delivery: "async",
        questions,
      }),
    ).toEqual({
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

  test("preserves question and option text while checking for blank values", () => {
    expect(
      parseCodexAsyncQuestionItem({
        type: "agentMessage",
        id: "call-spaces",
        text: "Choose",
        phase: "commentary",
        memoryCitation: null,
        delivery: "async",
        questions: [{ title: "  Keep title spacing  ", options: [" First ", "Second"] }],
      }),
    ).toEqual({
      kind: "questions",
      questions: [
        {
          questionItemId: codexAsyncQuestionItemId("call-spaces", 0),
          sourceMessageId: "call-spaces",
          questionIndex: 0,
          title: "  Keep title spacing  ",
          options: [" First ", "Second"],
        },
      ],
    });
  });

  test("parses one reply text input and ignores Codex skill and mention inputs", () => {
    const reply = { questionItemId: "question-1", question: "Which?", answer: "Staging" };

    expect(
      parseCodexAsyncQuestionReplyInputs([
        { type: "skill", name: "review", path: "/skills/review" },
        { type: "text", text: encodeCodexAsyncQuestionReply(reply), text_elements: [] },
        { type: "mention", name: "config.ts", path: "/repo/config.ts" },
      ]),
    ).toEqual([reply]);
    expect(
      parseCodexAsyncQuestionReplyInputs([
        { type: "text", text: encodeCodexAsyncQuestionReply(reply), text_elements: [] },
        { type: "text", text: "extra", text_elements: [] },
      ]),
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

  test("resolves all source questions from a legacy source-message reply ID", () => {
    const state = new CodexAsyncQuestionState();
    const questions = [0, 1].map((questionIndex) => ({
      questionItemId: codexAsyncQuestionItemId("call-legacy", questionIndex),
      sourceMessageId: "call-legacy",
      questionIndex,
      title: `Question ${questionIndex + 1}`,
      options: null,
    }));

    state.add("runtime", "thread", questions);
    state.resolve("runtime", "thread", ["call-legacy"]);

    expect(state.pendingForSession("runtime", "thread")).toEqual([]);
  });

  test("does not add questions after an early legacy source-message reply", () => {
    const state = new CodexAsyncQuestionState();
    const question = {
      questionItemId: codexAsyncQuestionItemId("call-early", 0),
      sourceMessageId: "call-early",
      questionIndex: 0,
      title: "Which?",
      options: null,
    };

    state.resolve("runtime", "thread", ["call-early"]);
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

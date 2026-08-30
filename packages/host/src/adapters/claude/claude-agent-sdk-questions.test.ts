import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import {
  createClaudeUserDialogHandler,
  isClaudeAskUserQuestionTool,
} from "./claude-agent-sdk-questions";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import type { ClaudeSessionContext } from "./claude-agent-sdk-types";

const createSession = (): ClaudeSessionContext => ({
  acceptedUserMessages: [],
  activeSdkUserTurnCount: 0,
  abortController: new AbortController(),
  activity: "idle",
  externalSessionId: "session-1",
  input: {
    repoPath: "/repo",
    runtimeKind: "claude",
    workingDirectory: "/repo",
    externalSessionId: "session-1",
    runtimePolicy: { kind: "claude" },
    sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" },
  },
  model: undefined,
  pendingApprovals: new Map(),
  pendingQuestions: new Map(),
  queuedSdkMessages: [],
  pendingUserTurnCount: 0,
  queue: new AsyncInputQueue(),
  runtimeId: "runtime-1",
  startedAt: "2026-06-25T12:00:00.000Z",
  summary: {
    externalSessionId: "session-1",
    runtimeKind: "claude",
    workingDirectory: "/repo",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
    startedAt: "2026-06-25T12:00:00.000Z",
    status: "idle",
  },
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolEndedAtMsByCallId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
  todosById: new Map(),
});

const createQuestionPayload = () => ({
  questions: [
    {
      question: "How should X sign-in handle missing email?",
      header: "X email",
      multiSelect: false,
      options: [
        {
          label: "Require email",
          description: "Reject sign-in when X does not return email.",
        },
        {
          label: "Allow without email",
          description: "Allow X accounts without email.",
        },
      ],
    },
  ],
});

describe("createClaudeUserDialogHandler", () => {
  test("matches only the complete built-in question tool name without case sensitivity", () => {
    expect(isClaudeAskUserQuestionTool(" askuserquestion ")).toBe(true);
    expect(isClaudeAskUserQuestionTool("ASKUSERQUESTION")).toBe(true);
    expect(isClaudeAskUserQuestionTool("mcp__example__AskUserQuestion")).toBe(false);
  });

  test("rejects non-JSON question dialog payloads before publishing a question", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const handler = createClaudeUserDialogHandler({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    await expect(
      handler(
        {
          dialogKind: "permission_ask_user_question",
          payload: { ...createQuestionPayload(), receivedAt: new Date() },
          toolUseID: "tool-use-1",
        },
        { signal: new AbortController().signal, requestId: "sdk-request-1" },
      ),
    ).rejects.toMatchObject({
      _tag: "HostValidationError",
      field: "claudeUserDialogPayload",
    });
    expect(events).toEqual([]);
    expect(session.pendingQuestions.size).toBe(0);
  });

  test("maps Claude AskUserQuestion dialogs to pending questions and returns answers", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const handler = createClaudeUserDialogHandler({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });
    const questionPayload = createQuestionPayload();

    const resultPromise = handler(
      {
        dialogKind: "permission_ask_user_question",
        payload: questionPayload,
        toolUseID: "tool-use-1",
      },
      { signal: new AbortController().signal, requestId: "sdk-request-1" },
    );

    expect(events).toEqual([
      {
        type: "question_required",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T12:00:00.000Z",
        requestId: "request-1",
        questions: [
          {
            question: "How should X sign-in handle missing email?",
            header: "X email",
            options: [
              {
                label: "Require email",
                description: "Reject sign-in when X does not return email.",
              },
              {
                label: "Allow without email",
                description: "Allow X accounts without email.",
              },
            ],
            multiple: false,
            custom: true,
          },
        ],
      },
    ]);
    expect(session.pendingQuestions.has("request-1")).toBe(true);

    session.pendingQuestions.get("request-1")?.resolve([["Require email"]]);

    await expect(resultPromise).resolves.toEqual({
      behavior: "completed",
      result: {
        questions: questionPayload.questions,
        answers: {
          "How should X sign-in handle missing email?": "Require email",
        },
      },
    });
  });

  test("cleans up pending questions when a Claude question dialog is aborted", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const abortController = new AbortController();
    const handler = createClaudeUserDialogHandler({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });
    const questionPayload = createQuestionPayload();

    const resultPromise = handler(
      {
        dialogKind: "permission_ask_user_question",
        payload: questionPayload,
        toolUseID: "tool-use-1",
      },
      { signal: abortController.signal, requestId: "sdk-request-1" },
    );

    expect(session.pendingQuestions.has("request-1")).toBe(true);
    abortController.abort();

    await expect(resultPromise).resolves.toEqual({ behavior: "cancelled" });
    expect(session.pendingQuestions.has("request-1")).toBe(false);
    expect(events).toEqual([
      expect.objectContaining({
        type: "question_required",
        requestId: "request-1",
      }),
      expect.objectContaining({
        type: "question_resolved",
        requestId: "request-1",
      }),
    ]);
  });

  test("cancels a Claude question dialog whose signal is already aborted", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const abortController = new AbortController();
    abortController.abort();
    const handler = createClaudeUserDialogHandler({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    await expect(
      handler(
        {
          dialogKind: "permission_ask_user_question",
          payload: createQuestionPayload(),
          toolUseID: "tool-use-1",
        },
        { signal: abortController.signal, requestId: "sdk-request-1" },
      ),
    ).resolves.toEqual({ behavior: "cancelled" });
    expect(session.pendingQuestions.size).toBe(0);
    expect(events).toEqual([]);
  });

  test("propagates question event delivery failures", async () => {
    const session = createSession();
    const deliveryError = new Error("question event delivery failed");
    const handler = createClaudeUserDialogHandler({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: () => {
        throw deliveryError;
      },
    });

    await expect(
      handler(
        {
          dialogKind: "permission_ask_user_question",
          payload: createQuestionPayload(),
          toolUseID: "tool-use-1",
        },
        { signal: new AbortController().signal, requestId: "sdk-request-1" },
      ),
    ).rejects.toBe(deliveryError);
    expect(session.pendingQuestions.has("request-1")).toBe(false);
  });

  test("cancels unrecognized dialog kinds", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const handler = createClaudeUserDialogHandler({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    await expect(
      handler(
        {
          dialogKind: "refusal_fallback_prompt",
          payload: {},
          toolUseID: "tool-use-1",
        },
        { signal: new AbortController().signal, requestId: "sdk-request-1" },
      ),
    ).resolves.toEqual({ behavior: "cancelled" });
    expect(events).toEqual([]);
    expect(session.pendingQuestions.size).toBe(0);
  });

  test("rejects recognized question dialogs with malformed payloads", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const handler = createClaudeUserDialogHandler({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    await expect(
      handler(
        {
          dialogKind: "permission_ask_user_question",
          payload: { questions: [] },
          toolUseID: "tool-use-1",
        },
        { signal: new AbortController().signal, requestId: "sdk-request-1" },
      ),
    ).rejects.toThrow("Claude AskUserQuestion dialog payload is invalid.");
    expect(events).toEqual([]);
    expect(session.pendingQuestions.size).toBe(0);
  });

  test("rejects duplicate normalized question texts", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const handler = createClaudeUserDialogHandler({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });
    const question = createQuestionPayload().questions[0];
    expect(question).toBeDefined();
    if (!question) {
      return;
    }

    await expect(
      handler(
        {
          dialogKind: "permission_ask_user_question",
          payload: {
            questions: [question, { ...question, question: ` ${question.question} ` }],
          },
          toolUseID: "tool-use-1",
        },
        { signal: new AbortController().signal, requestId: "sdk-request-1" },
      ),
    ).rejects.toThrow("Claude AskUserQuestion dialog payload is invalid.");
    expect(events).toEqual([]);
    expect(session.pendingQuestions.size).toBe(0);
  });
});

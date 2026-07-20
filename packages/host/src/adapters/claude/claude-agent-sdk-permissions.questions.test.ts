import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import {
  createClaudeCanUseTool,
  createClaudePermissionTestSession as createSession,
} from "./claude-agent-sdk-permissions.test-support";

describe("Claude permission questions", () => {
  test("maps Claude AskUserQuestion tool calls to pending questions and forwards answers", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const input = {
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
    };
    const resultPromise = canUseTool("AskUserQuestion", input, {
      signal: new AbortController().signal,
      toolUseID: "tool-use-1",
    });

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
      behavior: "allow",
      updatedInput: {
        ...input,
        answers: {
          "How should X sign-in handle missing email?": "Require email",
        },
      },
    });
  });

  test("maps namespaced Claude AskUserQuestion tool calls to pending questions", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const input = {
      questions: [
        {
          question: "Proceed?",
          header: "Decision",
          options: [
            {
              label: "Yes",
              description: "Proceed with the implementation.",
            },
            {
              label: "No",
              description: "Stop the implementation.",
            },
          ],
          multiSelect: false,
        },
      ],
    };
    const resultPromise = canUseTool("mcp__openducktor_ui__AskUserQuestion", input, {
      signal: new AbortController().signal,
      toolUseID: "tool-use-1",
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "question_required",
        requestId: "request-1",
        questions: [
          expect.objectContaining({
            question: "Proceed?",
            header: "Decision",
          }),
        ],
      }),
    ]);
    expect(session.pendingQuestions.has("request-1")).toBe(true);

    session.pendingQuestions.get("request-1")?.resolve([["Yes"]]);

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        ...input,
        answers: {
          "Proceed?": "Yes",
        },
      },
    });
  });

  test("denies Claude AskUserQuestion tool calls when the request is aborted", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });
    const abortController = new AbortController();

    const resultPromise = canUseTool(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Proceed?",
            header: "Decision",
            options: [
              {
                label: "Yes",
                description: "Proceed with the implementation.",
              },
              {
                label: "No",
                description: "Stop the implementation.",
              },
            ],
            multiSelect: false,
          },
        ],
      },
      {
        signal: abortController.signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(session.pendingQuestions.has("request-1")).toBe(true);
    abortController.abort();

    await expect(resultPromise).resolves.toEqual({
      behavior: "deny",
      message: "Claude question request was aborted.",
      interrupt: true,
    });
    expect(session.pendingQuestions.has("request-1")).toBe(false);
    expect(events).toEqual([
      expect.objectContaining({
        type: "question_required",
        requestId: "request-1",
      }),
    ]);
  });

  test("does not emit stale question events when the Claude question signal is already aborted", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });
    const abortController = new AbortController();
    abortController.abort();

    const result = await canUseTool(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Proceed?",
            header: "Decision",
            options: [
              {
                label: "Yes",
                description: "Proceed with the implementation.",
              },
              {
                label: "No",
                description: "Stop the implementation.",
              },
            ],
            multiSelect: false,
          },
        ],
      },
      {
        signal: abortController.signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      message: "Claude question request was aborted.",
      interrupt: true,
    });
    expect(session.pendingQuestions.size).toBe(0);
    expect(events).toEqual([]);
  });

  test("denies mutating shell commands in read-only roles before creating approval requests", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "Bash",
      { command: "rg --pre 'touch /tmp/odt-proof' foo ." },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool Bash is disabled for read-only OpenDucktor workflow roles.",
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("denies classified mutating tools in read-only roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "TodoWrite",
      { todos: [] },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool TodoWrite is disabled for read-only OpenDucktor workflow roles.",
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("delegates unclassified external tools to the configured approval flow", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const toolInput = { query: "authentication flow" };
    const resultPromise = canUseTool("mcp__semble__search", toolInput, {
      signal: new AbortController().signal,
      toolUseID: "tool-use-1",
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "approval_required",
        requestId: "request-1",
        mutation: "unknown",
        tool: {
          name: "mcp__semble__search",
          input: toolInput,
        },
      }),
    ]);
    expect(session.pendingApprovals.has("request-1")).toBe(true);
    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });
    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: toolInput,
    });
  });
});

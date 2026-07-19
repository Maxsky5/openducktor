import { describe, expect, test } from "bun:test";
import type { AgentEvent, AgentRole } from "@openducktor/core";
import { createClaudeCanUseTool as createClaudeCanUseToolBase } from "./claude-agent-sdk-permissions";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import type { ClaudeSessionContext } from "./claude-agent-sdk-types";

const createClaudeCanUseTool = (
  input: Parameters<typeof createClaudeCanUseToolBase>[0],
): ReturnType<typeof createClaudeCanUseToolBase> =>
  createClaudeCanUseToolBase({
    canonicalizePath: async (path) => path,
    ...input,
  });

const createSession = (role: AgentRole = "spec"): ClaudeSessionContext => ({
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
    sessionScope: { kind: "workflow", taskId: "task-1", role },
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
    role,
    startedAt: "2026-06-25T12:00:00.000Z",
    status: "idle",
  },
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
});

describe("createClaudeCanUseTool", () => {
  test("allows native Claude ODT read tool aliases for workflow roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "mcp__openducktor__odt_read_task",
      { taskId: "task-1" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "allow",
      updatedInput: { taskId: "task-1" },
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("denies native Claude ODT mutation tool aliases outside the role policy", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("spec");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "mcp__openducktor__odt_build_completed",
      { taskId: "task-1" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool odt_build_completed is not allowed for spec sessions.",
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("denies Bash entirely in read-only workflow roles", async () => {
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
      { command: "rg Claude packages/host" },
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

  test("requires approval for read-only shell inspection outside the worktree in build roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const resultPromise = canUseTool(
      "Bash",
      { command: "cat /etc/passwd" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "approval_required",
        requestId: "request-1",
        requestType: "command_execution",
        command: {
          command: "cat /etc/passwd",
          workingDirectory: "/repo",
        },
        tool: {
          name: "Bash",
          input: { command: "cat /etc/passwd" },
        },
        mutation: "mutating",
      }),
    ]);
    expect(session.pendingApprovals.has("request-1")).toBe(true);

    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "cat /etc/passwd" },
    });
  });

  test("publishes subagent approvals only to the child transcript", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const resultPromise = canUseTool(
      "Bash",
      { command: "git status" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
        agentID: "agent-child-1",
      },
    );

    const childExternalSessionId = "session-1::claude-subagent::agent-child-1";
    expect(events).toEqual([
      expect.objectContaining({
        type: "approval_required",
        externalSessionId: childExternalSessionId,
        parentExternalSessionId: "session-1",
        childExternalSessionId,
        subagentCorrelationKey: "agent-child-1",
        requestId: "request-1",
      }),
    ]);
    expect(session.pendingApprovals.get("request-1")?.event).toMatchObject({
      parentExternalSessionId: "session-1",
      childExternalSessionId,
      subagentCorrelationKey: "agent-child-1",
    });

    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });
    await expect(resultPromise).resolves.toMatchObject({ behavior: "allow" });
  });

  test("publishes subagent questions only to the child transcript", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const resultPromise = canUseTool(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Which approach should the subagent use?",
            header: "Approach",
            options: [{ label: "Direct", description: "Use the direct approach." }],
            multiSelect: false,
          },
        ],
      },
      {
        signal: new AbortController().signal,
        toolUseID: "question-child-1",
        agentID: "agent-child-1",
      },
    );

    const childExternalSessionId = "session-1::claude-subagent::agent-child-1";
    expect(events).toEqual([
      expect.objectContaining({
        type: "question_required",
        externalSessionId: childExternalSessionId,
        parentExternalSessionId: "session-1",
        childExternalSessionId,
        subagentCorrelationKey: "agent-child-1",
        requestId: "request-1",
      }),
    ]);

    session.pendingQuestions.get("request-1")?.resolve([["Direct"]]);
    await expect(resultPromise).resolves.toMatchObject({ behavior: "allow" });
  });
});

describe("Claude permission request lifecycle", () => {
  test("cleans up pending approvals when the Claude permission request is aborted", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });
    const abortController = new AbortController();

    const resultPromise = canUseTool(
      "Bash",
      { command: "cat /etc/passwd" },
      {
        signal: abortController.signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(session.pendingApprovals.has("request-1")).toBe(true);
    abortController.abort();

    await expect(resultPromise).resolves.toEqual({
      behavior: "deny",
      message: "Claude permission request was aborted.",
      interrupt: true,
    });
    expect(session.pendingApprovals.has("request-1")).toBe(false);
    expect(events).toEqual([
      expect.objectContaining({
        type: "approval_required",
        requestId: "request-1",
      }),
    ]);
  });

  test("does not create pending approvals when the Claude permission signal is already aborted", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });
    const abortController = new AbortController();
    abortController.abort();

    const result = await canUseTool(
      "Bash",
      { command: "cat /etc/passwd" },
      {
        signal: abortController.signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      message: "Claude permission request was aborted.",
      interrupt: true,
    });
    expect(session.pendingApprovals.size).toBe(0);
    expect(events).toEqual([]);
  });

  test("denies read-only shell inspection outside the session worktree for read-only roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("qa");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "Bash",
      { command: "cat ~/.ssh/config" },
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

  test("denies direct file reads outside the session worktree for read-only roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("planner");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "Read",
      { file_path: "/etc/passwd" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool Read attempted to read outside the session working directory: /etc/passwd",
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("denies reads whose canonical path escapes through a worktree symlink", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("qa");
    const canUseTool = createClaudeCanUseToolBase({
      session,
      canonicalizePath: async (path) =>
        path === "/repo/link/secret.txt" ? "/outside/secret.txt" : path,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "Read",
      { file_path: "/repo/link/secret.txt" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message:
        "Tool Read attempted to read outside the session working directory: /repo/link/secret.txt",
    });
    expect(events).toEqual([]);
  });

  test("denies subagents in read-only workflow roles before creating approval requests", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("spec");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "Agent",
      { prompt: "Inspect the repo" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool Agent is not classified as read-only for OpenDucktor spec sessions.",
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("denies network tools in read-only workflow roles before creating approval requests", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("spec");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const fetchResult = await canUseTool(
      "WebFetch",
      { url: "https://example.invalid/?leak=repo-data" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );
    const searchResult = await canUseTool(
      "WebSearch",
      { query: "repo secret" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-2",
      },
    );

    expect(fetchResult).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool WebFetch is disabled for read-only OpenDucktor workflow roles.",
    });
    expect(searchResult).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool WebSearch is disabled for read-only OpenDucktor workflow roles.",
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });
});

describe("Claude permission path routing", () => {
  test("routes Windows descendant and blocked paths through the session worktree", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    session.input = {
      ...session.input,
      repoPath: "C:\\Repo\\Fairnest",
      workingDirectory: "C:\\Repo\\Fairnest-task-worktree",
    };
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const resultPromise = canUseTool(
      "Write",
      { file_path: "c:\\repo\\fairnest\\apps\\api\\src\\auth.ts" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
        blockedPath: "c:\\repo\\fairnest\\apps\\api\\src\\auth.ts",
      },
    );

    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        file_path: "C:/Repo/Fairnest-task-worktree/apps/api/src/auth.ts",
      },
    });
    expect(events).toEqual([
      expect.objectContaining({
        affectedPaths: ["C:/Repo/Fairnest-task-worktree/apps/api/src/auth.ts"],
      }),
    ]);
  });

  test("routes the exact Windows repository path through the session worktree", async () => {
    const session = createSession("build");
    session.input = {
      ...session.input,
      repoPath: "C:\\Repo\\Fairnest",
      workingDirectory: "C:\\Repo\\Fairnest-task-worktree",
    };
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: () => {},
    });

    const resultPromise = canUseTool(
      "Write",
      { file_path: "c:\\repo\\fairnest" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );
    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: { file_path: "C:\\Repo\\Fairnest-task-worktree" },
    });
  });

  test("routes mixed-separator Windows descendants without matching sibling prefixes", async () => {
    const session = createSession("build");
    session.input = {
      ...session.input,
      repoPath: "C:\\Repo\\Fairnest",
      workingDirectory: "C:\\Repo\\Fairnest-task-worktree",
    };
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: () => {},
    });

    const mixedResultPromise = canUseTool(
      "Write",
      { file_path: "c:/repo/fairnest\\apps/api/src/auth.ts" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );
    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(mixedResultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        file_path: "C:/Repo/Fairnest-task-worktree/apps/api/src/auth.ts",
      },
    });

    const siblingResultPromise = canUseTool(
      "Write",
      { file_path: "C:\\Repo\\Fairnest-copy\\apps\\api\\src\\auth.ts" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-2",
      },
    );
    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(siblingResultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        file_path: "C:\\Repo\\Fairnest-copy\\apps\\api\\src\\auth.ts",
      },
    });
  });

  test("routes Claude file paths through the session worktree", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    session.input = {
      ...session.input,
      repoPath: "/repo/fairnest",
      workingDirectory: "/repo/fairnest-task-worktree",
    };
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "Read",
      { file_path: "/repo/fairnest/apps/api/src/lib/auth.ts" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
        blockedPath: "/repo/fairnest/apps/api/src/lib/auth.ts",
      },
    );

    expect(result).toEqual({
      behavior: "allow",
      updatedInput: {
        file_path: "/repo/fairnest-task-worktree/apps/api/src/lib/auth.ts",
      },
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("preserves Bash commands exactly while routing non-shell file paths", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    session.input = {
      ...session.input,
      repoPath: "/repo/fairnest",
      workingDirectory: "/repo/fairnest-task-worktree",
    };
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const command = 'cd "/repo/fairnest"; rg auth apps/api/src/lib/auth.ts';
    const resultPromise = canUseTool(
      "Bash",
      { command },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(session.pendingApprovals.has("request-1")).toBe(true);
    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    const result = await resultPromise;
    expect(result).toEqual({
      behavior: "allow",
      updatedInput: { command },
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "approval_required",
        requestId: "request-1",
        command: {
          command,
          workingDirectory: "/repo/fairnest-task-worktree",
        },
        tool: {
          name: "Bash",
          input: { command },
        },
      }),
    ]);
    expect(session.pendingApprovals.get("request-1")?.event.command?.command).toBe(command);
  });

  test("does not rewrite sibling worktree names that only share the durable repo prefix", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    session.input = {
      ...session.input,
      repoPath: "/Users/maxsky5/projects/perso/fairnest",
      workingDirectory: "/Users/maxsky5/projects/perso/fairnest-io69",
    };
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const resultPromise = canUseTool(
      "Bash",
      {
        command:
          "git -C /Users/maxsky5/projects/perso/fairnest-io69 diff --stat && ls /Users/maxsky5/projects/perso/fairnest/apps",
      },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
        displayName: "Bash",
      },
    );

    expect(events).toEqual([
      expect.objectContaining({
        command: {
          command:
            "git -C /Users/maxsky5/projects/perso/fairnest-io69 diff --stat && ls /Users/maxsky5/projects/perso/fairnest/apps",
          workingDirectory: "/Users/maxsky5/projects/perso/fairnest-io69",
        },
        tool: expect.objectContaining({
          input: {
            command:
              "git -C /Users/maxsky5/projects/perso/fairnest-io69 diff --stat && ls /Users/maxsky5/projects/perso/fairnest/apps",
          },
        }),
      }),
    ]);

    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        command:
          "git -C /Users/maxsky5/projects/perso/fairnest-io69 diff --stat && ls /Users/maxsky5/projects/perso/fairnest/apps",
      },
    });
  });

  test("denies mutating shell commands for read-only roles without interrupting the session", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("planner");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "Bash",
      { command: "node scripts/update.js" },
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
});

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

  test("denies unclassified tools in read-only roles before creating approval requests", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "ExternalWriteTool",
      {},
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message:
        "Tool ExternalWriteTool is not classified as read-only for OpenDucktor spec sessions.",
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });
});

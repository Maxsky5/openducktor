import { describe, expect, mock, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { HostDependencyError } from "../../effect/host-errors";
import { createArtifactRuntimeDistribution } from "../runtimes/runtime-distribution";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { createClaudeAgentSdkService } from "./claude-agent-sdk-service";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import type {
  ClaudeAgentSdkEventEmitter,
  ClaudeSession,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";

const createSession = (overrides: Partial<ClaudeSession> = {}): ClaudeSession => ({
  acceptedUserMessages: [],
  activeSdkUserTurnCount: 0,
  abortController: new AbortController(),
  activity: "idle",
  externalSessionId: "session-1",
  input: {
    repoPath: "/repo/",
    runtimeKind: "claude",
    workingDirectory: "/repo/worktree/",
    externalSessionId: "session-1",
    runtimePolicy: { kind: "claude" },
    sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    systemPrompt: "Build",
  },
  model: undefined,
  pendingApprovals: new Map(),
  pendingQuestions: new Map(),
  queuedSdkMessages: [],
  pendingUserTurnCount: 0,
  query: {
    close: mock(() => {}),
  } as unknown as ClaudeSession["query"],
  queue: new AsyncInputQueue(),
  runtimeId: "runtime-1",
  startedAt: "2026-06-25T20:00:00.000Z",
  summary: {
    externalSessionId: "session-1",
    runtimeKind: "claude",
    workingDirectory: "/repo/worktree/",
    role: "build",
    startedAt: "2026-06-25T20:00:00.000Z",
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
  ...overrides,
});

const listClaudeMcpTokenDirectories = async (): Promise<Set<string>> =>
  new Set((await readdir(tmpdir())).filter((name) => name.startsWith("openducktor-claude-mcp-")));

const expectNoNewClaudeMcpTokenDirectories = async (before: Set<string>): Promise<void> => {
  let created: string[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const after = await listClaudeMcpTokenDirectories();
    created = [...after].filter((name) => !before.has(name));
    if (created.length === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(created).toEqual([]);
};

const createService = (session: ClaudeSession | null, emit?: ClaudeAgentSdkEventEmitter) => {
  const sessionStore = createClaudeAgentSdkSessionStore({
    now: () => "2026-06-25T20:00:00.000Z",
  });
  if (session) {
    sessionStore.set(session);
  }
  return createClaudeAgentSdkService({
    ...(emit ? { emit } : {}),
    now: () => "2026-06-25T20:00:00.000Z",
    onBackgroundFailure: () => Effect.void,
    resolveMcpBridgeConnection: () => {
      throw new Error("unused");
    },
    runtimeDistribution: createArtifactRuntimeDistribution({
      mcpLauncher: {
        kind: "executable",
        executablePath: process.execPath,
      },
    }),
    sessionStore,
    toolDiscovery: {} as CreateClaudeAgentSdkServiceInput["toolDiscovery"],
  });
};

describe("createClaudeAgentSdkService", () => {
  test("loads context usage through the detached SDK path when the session is not live", async () => {
    const loadDetachedSessionContextUsage = mock(
      async (_input: {
        claudeExecutablePath: string;
        externalSessionId: string;
        processEnv?: NodeJS.ProcessEnv;
        workingDirectory: string;
      }) => ({
        totalTokens: 176_005,
        contextWindow: 272_000,
      }),
    );
    const sessionStore = createClaudeAgentSdkSessionStore({
      now: () => "2026-06-25T20:00:00.000Z",
    });
    const service = createClaudeAgentSdkService(
      {
        now: () => "2026-06-25T20:00:00.000Z",
        onBackgroundFailure: () => Effect.void,
        processEnv: { HOME: "/home/user" },
        resolveMcpBridgeConnection: () => {
          throw new Error("unused");
        },
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: {
            kind: "executable",
            executablePath: process.execPath,
          },
        }),
        sessionStore,
        toolDiscovery: {
          resolveTool: () => {
            throw new Error("unused");
          },
          resolveToolPath: () => Effect.succeed("/usr/local/bin/claude"),
        },
      },
      { loadDetachedSessionContextUsage },
    );

    await expect(
      Effect.runPromise(
        service.loadSessionContextUsage({
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          externalSessionId: "session-1::claude-subagent::task-1",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      ),
    ).resolves.toEqual({ totalTokens: 176_005, contextWindow: 272_000 });

    expect(loadDetachedSessionContextUsage).toHaveBeenCalledTimes(1);
    expect(loadDetachedSessionContextUsage.mock.calls[0]?.[0]).toEqual({
      claudeExecutablePath: "/usr/local/bin/claude",
      externalSessionId: "session-1",
      processEnv: { HOME: "/home/user" },
      workingDirectory: "/repo/worktree/",
    });
  });

  test("reads context usage from an idle live Claude session without resuming it", async () => {
    const getContextUsage = mock(
      async () =>
        ({
          totalTokens: 176_005,
          maxTokens: 272_000,
        }) as Awaited<ReturnType<Query["getContextUsage"]>>,
    );
    const service = createService(
      createSession({
        query: {
          close: mock(() => {}),
          getContextUsage,
        } as unknown as ClaudeSession["query"],
      }),
    );

    await expect(
      Effect.runPromise(
        service.loadSessionContextUsage({
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      ),
    ).resolves.toEqual({ totalTokens: 176_005, contextWindow: 272_000 });

    expect(getContextUsage).toHaveBeenCalledTimes(1);
  });

  test("returns the live Claude TODO snapshot", async () => {
    const todo = {
      id: "1",
      content: "Implement Facebook auth",
      status: "in_progress" as const,
      priority: "medium" as const,
    };
    const service = createService(
      createSession({
        todosById: new Map([[todo.id, todo]]),
      }),
    );

    await expect(
      Effect.runPromise(
        service.loadSessionTodos({
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      ),
    ).resolves.toEqual([todo]);
  });

  test("emits nested transcript events for host-owned projection", () => {
    const session = createSession();
    const emitted: Array<{ session: ClaudeSession; event: unknown }> = [];
    const service = createService(session, (eventSession, event) => {
      emitted.push({ session: eventSession as ClaudeSession, event });
    });
    const emit = Reflect.get(service as object, "emit") as (
      session: ClaudeSession,
      event: {
        type: "assistant_message";
        externalSessionId: string;
        timestamp: string;
        messageId: string;
        message: string;
      },
    ) => void;

    emit.call(service, session, {
      type: "assistant_message",
      externalSessionId: "session-1::claude-subagent::task-1",
      timestamp: "2026-06-25T20:00:01.000Z",
      messageId: "assistant-child-1",
      message: "Nested update",
    });

    expect(emitted).toEqual([
      {
        session,
        event: expect.objectContaining({
          externalSessionId: "session-1::claude-subagent::task-1",
        }),
      },
    ]);
  });

  test("cleans session-scoped MCP token files when Claude executable resolution fails before store ownership", async () => {
    const before = await listClaudeMcpTokenDirectories();
    const sessionStore = createClaudeAgentSdkSessionStore({
      now: () => "2026-06-25T20:00:00.000Z",
    });
    const service = createClaudeAgentSdkService({
      now: () => "2026-06-25T20:00:00.000Z",
      onBackgroundFailure: () => Effect.void,
      randomId: () => "session-1",
      resolveMcpBridgeConnection: () =>
        Effect.succeed({
          workspaceId: "workspace-1",
          hostUrl: "http://127.0.0.1:1",
          hostToken: "bridge-secret-value",
        }),
      runtimeDistribution: createArtifactRuntimeDistribution({
        mcpLauncher: {
          kind: "executable",
          executablePath: process.execPath,
        },
      }),
      sessionStore,
      toolDiscovery: {
        resolveTool: () => Effect.die("unused"),
        resolveToolPath: (toolId) =>
          toolId === "claude"
            ? Effect.fail(
                new HostDependencyError({
                  dependency: "claude",
                  message: "claude unavailable",
                }),
              )
            : Effect.succeed(process.execPath),
      },
    });

    await expect(
      Effect.runPromise(
        service.startSession(
          {
            repoPath: "/repo/",
            runtimeKind: "claude",
            workingDirectory: "/repo/worktree/",
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
            systemPrompt: "Build",
          },
          "runtime-claude",
        ),
      ),
    ).rejects.toThrow("claude unavailable");

    expect([...sessionStore.values()]).toEqual([]);
    await expectNoNewClaudeMcpTokenDirectories(before);
  });

  test("validates existing live session refs before resuming", async () => {
    const service = createService(createSession());

    await expect(
      Effect.runPromise(
        service.resumeSession(
          {
            repoPath: "/other-repo",
            runtimeKind: "claude",
            workingDirectory: "/repo/worktree",
            externalSessionId: "session-1",
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
            systemPrompt: "Build",
          },
          "runtime-claude",
        ),
      ),
    ).rejects.toThrow(
      "Cannot resume Claude session 'session-1' from repo '/other-repo' and working directory '/repo/worktree'",
    );
  });

  test("applies live Claude effort changes through the SDK session", async () => {
    const setModel = mock(async (_model?: string) => {});
    const applyFlagSettings = mock(async (_settings: unknown) => {});
    const session = createSession({
      model: {
        runtimeKind: "claude",
        providerId: "claude",
        modelId: "claude-opus-4-6",
        variant: "high",
      },
      query: {
        applyFlagSettings,
        close: mock(() => {}),
        setModel,
      } as unknown as ClaudeSession["query"],
    });
    const service = createService(session);

    await expect(
      Effect.runPromise(
        service.updateSessionModel({
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          externalSessionId: "session-1",
          model: {
            runtimeKind: "claude",
            providerId: "claude",
            modelId: "claude-opus-4-6",
            variant: "xhigh",
          },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(setModel).not.toHaveBeenCalled();
    expect(applyFlagSettings).toHaveBeenCalledWith({ effortLevel: "xhigh" });
    expect(session.model?.variant).toBe("xhigh");
  });

  test("resolves live Claude question replies", async () => {
    const resolvedAnswers: string[][][] = [];
    const session = createSession({
      pendingQuestions: new Map([
        [
          "question-1",
          {
            event: {
              type: "question_required",
              externalSessionId: "session-1",
              timestamp: "2026-06-25T20:00:00.000Z",
              requestId: "question-1",
              questions: [
                {
                  header: "X email",
                  question: "How should X sign-in handle missing email?",
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
            resolve: (answers) => resolvedAnswers.push(answers),
          },
        ],
      ]),
    });
    const service = createService(session);

    await expect(
      Effect.runPromise(
        service.replyQuestion({
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          requestId: "question-1",
          answers: [["Require email"]],
        }),
      ),
    ).resolves.toBeUndefined();

    expect(session.pendingQuestions.size).toBe(0);
    expect(resolvedAnswers).toEqual([[["Require email"]]]);
  });

  test("resolves live Claude approval replies and emits resolution events", async () => {
    const resolvedResults: unknown[] = [];
    const session = createSession({
      pendingApprovals: new Map([
        [
          "approval-1",
          {
            event: {
              type: "approval_required",
              externalSessionId: "session-1",
              timestamp: "2026-06-25T20:00:00.000Z",
              requestId: "approval-1",
              requestType: "command_execution",
              title: "Approve Bash",
              tool: { name: "Bash", input: { command: "cat /etc/passwd" } },
              mutation: "read_only",
            },
            resolve: (result) => resolvedResults.push(result),
          },
        ],
      ]),
    });
    const emitted: unknown[] = [];
    const service = createService(session, (_eventSession, event) => {
      emitted.push(event);
    });

    await expect(
      Effect.runPromise(
        service.replyApproval({
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          requestId: "approval-1",
          outcome: "approve_once",
        }),
      ),
    ).resolves.toBeUndefined();

    expect(session.pendingApprovals.size).toBe(0);
    expect(resolvedResults).toEqual([{ behavior: "allow" }]);
    expect(emitted).toEqual([
      expect.objectContaining({
        externalSessionId: "session-1",
        type: "approval_resolved",
        requestId: "approval-1",
        timestamp: "2026-06-25T20:00:00.000Z",
      }),
    ]);
  });

  test("resolves subagent approval replies through the child live-session route", async () => {
    const childExternalSessionId = "session-1::claude-subagent::agent-child-1";
    const resolvedResults: unknown[] = [];
    const session = createSession({
      pendingApprovals: new Map([
        [
          "approval-child-1",
          {
            event: {
              type: "approval_required",
              externalSessionId: "session-1",
              timestamp: "2026-06-25T20:00:00.000Z",
              requestId: "approval-child-1",
              requestType: "command_execution",
              title: "Approve Bash",
              tool: { name: "Bash", input: { command: "git status" } },
              mutation: "read_only",
              parentExternalSessionId: "session-1",
              childExternalSessionId,
              subagentCorrelationKey: "agent-child-1",
            },
            resolve: (result) => resolvedResults.push(result),
          },
        ],
      ]),
    });
    const emitted: unknown[] = [];
    const service = createService(session, (_eventSession, event) => {
      emitted.push(event);
    });

    await expect(
      Effect.runPromise(
        service.replyApproval({
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          externalSessionId: childExternalSessionId,
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          requestId: "approval-child-1",
          outcome: "approve_once",
        }),
      ),
    ).resolves.toBeUndefined();

    expect(session.pendingApprovals.size).toBe(0);
    expect(resolvedResults).toEqual([{ behavior: "allow" }]);
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "approval_resolved",
        externalSessionId: childExternalSessionId,
        parentExternalSessionId: "session-1",
        childExternalSessionId,
        subagentCorrelationKey: "agent-child-1",
      }),
    ]);
  });

  test("rejects session-scoped approval outcomes without consuming the pending request", async () => {
    const session = createSession({
      pendingApprovals: new Map([
        [
          "approval-1",
          {
            event: {
              type: "approval_required",
              externalSessionId: "session-1",
              timestamp: "2026-06-25T20:00:00.000Z",
              requestId: "approval-1",
              requestType: "command_execution",
              title: "Approve Bash",
              tool: { name: "Bash", input: { command: "git status" } },
            },
            resolve: () => {},
          },
        ],
      ]),
    });
    const service = createService(session);

    await expect(
      Effect.runPromise(
        service.replyApproval({
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          requestId: "approval-1",
          outcome: "approve_session",
        }),
      ),
    ).rejects.toThrow("Claude approval replies support only approve_once or reject");

    expect(session.pendingApprovals.has("approval-1")).toBe(true);
  });
});

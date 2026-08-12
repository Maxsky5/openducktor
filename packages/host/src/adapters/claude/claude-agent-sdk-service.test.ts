import { describe, expect, mock, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { HostDependencyError } from "../../effect/host-errors";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
import { createArtifactRuntimeDistribution } from "../runtimes/runtime-distribution";
import { scheduleClaudeLiveContextUsageRefresh } from "./claude-agent-sdk-context-usage";
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
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
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
  test("resumes and sends through a retained repository session without a fake workflow role", async () => {
    const repositoryScope = { kind: "repository" } as const;
    const mcpServerStatus = mock(async () => [{ name: "openducktor", status: "connected" }]);
    const repositorySession = createSession({
      input: {
        repoPath: "/repo/",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree/",
        externalSessionId: "session-1",
        runtimePolicy: { kind: "claude" },
        sessionScope: repositoryScope,
      },
      summary: {
        externalSessionId: "session-1",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree/",
        title: "Repository session",
        sessionAssociation: repositoryScope,
        startedAt: "2026-06-25T20:00:00.000Z",
        status: "idle",
      },
      query: {
        close: mock(() => {}),
        getContextUsage: mock(async () => ({})),
        mcpServerStatus,
      } as unknown as ClaudeSession["query"],
    });
    const service = createService(repositorySession);

    await expect(
      Effect.runPromise(
        service.resumeSession(
          {
            repoPath: "/repo/",
            runtimeKind: "claude",
            workingDirectory: "/repo/worktree/",
            externalSessionId: "session-1",
            runtimePolicy: { kind: "claude" },
            sessionScope: repositoryScope,
          },
          "runtime-claude",
        ),
      ),
    ).resolves.toMatchObject({ sessionAssociation: repositoryScope });
    await expect(
      Effect.runPromise(
        service.sendUserMessage(
          {
            repoPath: "/repo/",
            runtimeKind: "claude",
            workingDirectory: "/repo/worktree/",
            externalSessionId: "session-1",
            runtimePolicy: { kind: "claude" },
            sessionScope: repositoryScope,
            parts: [{ kind: "text", text: "Hello" }],
          },
          "runtime-claude",
        ),
      ),
    ).resolves.toMatchObject({ type: "user_message", externalSessionId: "session-1" });
    await expect(
      Effect.runPromise(
        service.loadSessionContextUsage({
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          sessionScope: repositoryScope,
        }),
      ),
    ).resolves.toBeNull();
    expect(mcpServerStatus).toHaveBeenCalledTimes(3);
  });

  test("rejects retained Claude session scope drift", async () => {
    const service = createService(
      createSession({
        input: {
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "repository" },
        },
        summary: {
          externalSessionId: "session-1",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          title: "Repository session",
          sessionAssociation: { kind: "repository" },
          startedAt: "2026-06-25T20:00:00.000Z",
          status: "idle",
        },
      }),
    );

    await expect(
      Effect.runPromise(
        service.resumeSession(
          {
            repoPath: "/repo/",
            runtimeKind: "claude",
            workingDirectory: "/repo/worktree/",
            externalSessionId: "session-1",
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          },
          "runtime-claude",
        ),
      ),
    ).rejects.toThrow("registered repository scope does not match requested workflow scope");
  });

  test("loads persisted history for resumed and forked live sessions before a new user turn", async () => {
    const resumedSession = createSession();
    const forkedSession = createSession({
      input: {
        repoPath: "/repo/",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree/",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        systemPrompt: "Build",
        parentExternalSessionId: "parent-session",
      },
    });

    for (const session of [resumedSession, forkedSession]) {
      await expect(
        Effect.runPromise(
          createService(session).loadSessionHistory({
            repoPath: "/repo/",
            runtimeKind: "claude",
            workingDirectory: "/repo/worktree/",
            externalSessionId: session.externalSessionId,
            runtimePolicy: { kind: "claude" },
          }),
        ),
      ).rejects.toThrow("Failed to load Claude session");
    }
  });

  test("rejects live history reads from another working directory", () => {
    const service = createService(createSession());

    expect(() =>
      service.loadSessionHistory({
        repoPath: "/repo/",
        runtimeKind: "claude",
        workingDirectory: "/repo/other-worktree/",
        externalSessionId: "session-1",
        runtimePolicy: { kind: "claude" },
      }),
    ).toThrow("Cannot load session history Claude session 'session-1'");
  });

  test("rejects live child history and TODO reads from another working directory", () => {
    const service = createService(createSession());
    const childExternalSessionId = "session-1::claude-subagent::child-1";
    const ref = {
      repoPath: "/repo/",
      runtimeKind: "claude" as const,
      workingDirectory: "/repo/other-worktree/",
      externalSessionId: childExternalSessionId,
      runtimePolicy: { kind: "claude" as const },
    };

    expect(() => service.loadSessionHistory(ref)).toThrow(
      "Cannot load session history Claude session 'session-1'",
    );
    expect(() => service.loadSessionTodos(ref)).toThrow(
      "Cannot load session todos Claude session 'session-1'",
    );
  });

  test("loads detached root context usage but not parent usage for a subagent", async () => {
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
        settingsConfig: createFixedRuntimeSettingsConfig("claude", "/usr/local/bin/claude"),
        toolDiscovery: {
          resolveTool: () => {
            throw new Error("unused");
          },
          resolveToolPath: () => Effect.succeed("/usr/local/bin/claude"),
          validateToolPath: (_toolId, executablePath) =>
            Effect.succeed({
              displayLabel: "Claude",
              path: executablePath,
              sourceCategory: "provided_path",
            }),
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
    ).resolves.toBeNull();

    expect(loadDetachedSessionContextUsage).not.toHaveBeenCalled();

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

    expect(loadDetachedSessionContextUsage).toHaveBeenCalledTimes(1);
    expect(loadDetachedSessionContextUsage.mock.calls[0]?.[0]).toEqual({
      claudeExecutablePath: "/usr/local/bin/claude",
      externalSessionId: "session-1",
      processEnv: { HOME: "/home/user" },
      workingDirectory: "/repo/worktree/",
    });
  });

  test("does not report live parent context usage for a Claude subagent", async () => {
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
          externalSessionId: "session-1::claude-subagent::task-1",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      ),
    ).resolves.toBeNull();

    expect(getContextUsage).not.toHaveBeenCalled();
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

  test("drains live context refreshes before releasing a session", async () => {
    const contextRead = Promise.withResolvers<{ maxTokens: number; totalTokens: number }>();
    const queryClosed = Promise.withResolvers<void>();
    const session = createSession({
      query: {
        close: mock(() => queryClosed.resolve()),
        getContextUsage: () => contextRead.promise,
      } as unknown as ClaudeSession["query"],
    });
    scheduleClaudeLiveContextUsageRefresh({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      emit: () => {},
      onBackgroundFailure: () => Effect.void,
    });

    let released = false;
    const releasePromise = Effect.runPromise(
      createService(session).releaseSession({
        repoPath: "/repo/",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree/",
        externalSessionId: "session-1",
      }),
    ).then(() => {
      released = true;
    });
    await queryClosed.promise;
    await Promise.resolve();
    expect(released).toBe(false);

    contextRead.resolve({ maxTokens: 200_000, totalTokens: 95_000 });
    await releasePromise;

    expect(released).toBe(true);
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
      settingsConfig: createFixedRuntimeSettingsConfig("claude", "/usr/local/bin/claude"),
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
        validateToolPath: () =>
          Effect.fail(
            new HostDependencyError({
              dependency: "claude",
              message: "claude unavailable",
            }),
          ),
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

  test("keeps the latest live selection as the queued-turn restore model", async () => {
    const session = createSession({
      model: {
        runtimeKind: "claude",
        providerId: "claude",
        modelId: "claude-opus-4-6",
        variant: "xhigh",
      },
      modelAfterQueuedTurns: {
        runtimeKind: "claude",
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        variant: "high",
      },
      query: {
        applyFlagSettings: mock(async (_settings: unknown) => {}),
        close: mock(() => {}),
        setModel: mock(async (_model?: string) => {}),
      } as unknown as ClaudeSession["query"],
    });
    const service = createService(session);
    const latestModel = {
      runtimeKind: "claude" as const,
      providerId: "claude",
      modelId: "claude-haiku-4-5",
      variant: "low",
    };

    await Effect.runPromise(
      service.updateSessionModel({
        repoPath: "/repo/",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree/",
        externalSessionId: "session-1",
        model: latestModel,
      }),
    );

    expect(session.model).toEqual(latestModel);
    expect(session.modelAfterQueuedTurns).toEqual(latestModel);
  });

  test("defers model changes for cold Claude sessions", async () => {
    const service = createService(null);

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
  });

  test("prepares live Claude question replies before completing them", async () => {
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

    const resolution = await Effect.runPromise(
      service.prepareQuestionReply({
        repoPath: "/repo/",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree/",
        externalSessionId: "session-1",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        requestId: "question-1",
        answers: [["Require email"]],
      }),
    );

    expect(session.pendingQuestions.size).toBe(1);
    expect(resolvedAnswers).toEqual([]);
    expect(resolution.event).toMatchObject({
      externalSessionId: "session-1",
      type: "question_resolved",
      requestId: "question-1",
    });

    resolution.complete();

    expect(session.pendingQuestions.size).toBe(0);
    expect(resolvedAnswers).toEqual([[["Require email"]]]);
  });

  test("prepares live Claude approval replies before completing them", async () => {
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
    const service = createService(session);
    const resolution = await Effect.runPromise(
      service.prepareApprovalReply({
        repoPath: "/repo/",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree/",
        externalSessionId: "session-1",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        requestId: "approval-1",
        outcome: "approve_once",
      }),
    );

    expect(session.pendingApprovals.size).toBe(1);
    expect(resolvedResults).toEqual([]);
    expect(resolution.event).toMatchObject({
      externalSessionId: "session-1",
      type: "approval_resolved",
      requestId: "approval-1",
      timestamp: "2026-06-25T20:00:00.000Z",
    });

    resolution.complete();

    expect(session.pendingApprovals.size).toBe(0);
    expect(resolvedResults).toEqual([{ behavior: "allow" }]);
  });

  test("prepares subagent approval replies for the child live-session route", async () => {
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
    const service = createService(session);
    const resolution = await Effect.runPromise(
      service.prepareApprovalReply({
        repoPath: "/repo/",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree/",
        externalSessionId: childExternalSessionId,
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        requestId: "approval-child-1",
        outcome: "approve_once",
      }),
    );

    expect(session.pendingApprovals.size).toBe(1);
    expect(resolvedResults).toEqual([]);
    expect(resolution.event).toMatchObject({
      type: "approval_resolved",
      externalSessionId: childExternalSessionId,
      parentExternalSessionId: "session-1",
      childExternalSessionId,
      subagentCorrelationKey: "agent-child-1",
    });

    resolution.complete();

    expect(session.pendingApprovals.size).toBe(0);
    expect(resolvedResults).toEqual([{ behavior: "allow" }]);
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
        service.prepareApprovalReply({
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

  test("rejects malformed question answers without consuming the pending request", async () => {
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
                  header: "Decision",
                  question: "Proceed?",
                  options: [
                    { label: "Yes", description: "Continue." },
                    { label: "No", description: "Stop." },
                  ],
                  multiple: false,
                  custom: true,
                },
              ],
            },
            resolve: () => {
              throw new Error("Malformed answers must not resolve the SDK request.");
            },
          },
        ],
      ]),
    });
    const service = createService(session);
    const input = {
      repoPath: "/repo/",
      runtimeKind: "claude" as const,
      workingDirectory: "/repo/worktree/",
      externalSessionId: "session-1",
      runtimePolicy: { kind: "claude" as const },
      sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
      requestId: "question-1",
    };
    const invalidAnswers = [
      { answers: [], message: "exactly 1 answer group" },
      { answers: [[]], message: "at least one answer" },
      { answers: [["   "]], message: "non-blank answers" },
      { answers: [["Yes", "No"]], message: "only one answer" },
    ];

    for (const invalid of invalidAnswers) {
      await expect(
        Effect.runPromise(
          service.prepareQuestionReply({
            ...input,
            answers: invalid.answers,
          }),
        ),
      ).rejects.toThrow(invalid.message);
      expect(session.pendingQuestions.has("question-1")).toBe(true);
    }
  });
});

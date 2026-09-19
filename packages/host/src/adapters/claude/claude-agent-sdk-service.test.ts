import { describe, expect, mock, test } from "bun:test";
import { AgentRuntimeQueryError, InterruptedTurnResumeError } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createArtifactRuntimeDistribution } from "../runtimes/runtime-distribution";
import { scheduleClaudeLiveContextUsageRefresh } from "./claude-agent-sdk-context-usage";
import { createClaudeAgentSdkService } from "./claude-agent-sdk-service";
import {
  checkLiveClaudeContinuationEligibility,
  classifyPersistedClaudeContinuationFailure,
} from "./claude-agent-sdk-service-continuation";
import {
  createClaudeContextUsageResponse,
  createClaudeQueryFixture,
  createClaudeSession,
} from "./claude-agent-sdk-session-io.test-support";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import type {
  ClaudeAgentSdkEventEmitter,
  ClaudeSession,
  ClaudeSessionStore,
} from "./claude-agent-sdk-types";

const createSession = (overrides: Partial<ClaudeSession> = {}): ClaudeSession =>
  createClaudeSession({
    input: {
      repoPath: "/repo/",
      runtimeKind: "claude",
      workingDirectory: "/repo/worktree/",
      externalSessionId: "session-1",
      runtimePolicy: { kind: "claude" },
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      systemPrompt: "Build",
    },
    runtimeId: "runtime-1",
    summary: {
      externalSessionId: "session-1",
      runtimeKind: "claude",
      workingDirectory: "/repo/worktree/",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      startedAt: "2026-06-25T20:00:00.000Z",
      status: "idle",
    },
    ...overrides,
  });

const createService = (
  session: ClaudeSession | null,
  emit?: ClaudeAgentSdkEventEmitter,
  existingSessionStore?: ClaudeSessionStore,
  overrides: Partial<Parameters<typeof createClaudeAgentSdkService>[0]> = {},
) => {
  const sessionStore =
    existingSessionStore ??
    createClaudeAgentSdkSessionStore({
      now: () => "2026-06-25T20:00:00.000Z",
    });
  if (session) {
    sessionStore.set(session);
  }
  const serviceInput: Parameters<typeof createClaudeAgentSdkService>[0] = {
    claudeExecutablePath: process.execPath,
    fileSearch: { prewarm: () => {}, release: () => {}, search: async () => [] },
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
    toolDiscovery: {
      discoverTool: () => Effect.die("unused"),
      resolveTool: () => Effect.die("unused"),
      resolveToolPath: (toolId) =>
        toolId === "claude" ? Effect.succeed(process.execPath) : Effect.die("unused"),
      validateToolPath: (toolId, executablePath) =>
        toolId === "claude" && executablePath === process.execPath
          ? Effect.succeed({
              displayLabel: "Saved path",
              path: executablePath,
              sourceCategory: "provided_path" as const,
            })
          : Effect.die("unused"),
    },
    ...overrides,
  };
  if (emit) {
    serviceInput.emit = emit;
  }
  return createClaudeAgentSdkService(serviceInput);
};

describe("createClaudeAgentSdkService", () => {
  test("resolves a cold child parent without starting or admitting a session", async () => {
    const emit = mock(() => {});
    const service = createService(null, emit);
    const ref = {
      repoPath: "/repo",
      runtimeKind: "claude" as const,
      workingDirectory: "/repo",
      externalSessionId: "root::claude-subagent::child",
    };
    await expect(Effect.runPromise(service.resolveSessionParent(ref))).resolves.toBe("root");
    await expect(
      Effect.runPromise(service.resolveSessionParent({ ...ref, externalSessionId: "root" })),
    ).resolves.toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });
  test("resumes and sends through a retained repository session without a fake workflow role", async () => {
    const repositoryScope = { kind: "repository" } as const;
    const mcpServerStatus = mock(async () => [
      { name: "openducktor", status: "connected" as const },
    ]);
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
      query: createClaudeQueryFixture({
        close: mock(() => {}),
        getContextUsage: mock(async () => createClaudeContextUsageResponse(0, 0)),
        mcpServerStatus,
      }),
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
      ).rejects.toThrow("The selected Claude session is unavailable");
    }
  });

  test("loads live accepted history before a fresh session transcript exists", async () => {
    const session = createSession({
      activeSdkUserTurnCount: 1,
      activity: "running",
      acceptedUserMessages: [
        {
          messageId: "user-1",
          parts: [],
          text: "Inspect the prompt builder.",
          timestamp: "2026-06-25T20:00:01.000Z",
        },
      ],
      input: {
        repoPath: "/repo/",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree/",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        systemPrompt: "Build",
      },
    });

    await expect(
      Effect.runPromise(
        createService(session).loadSessionHistory({
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
        }),
      ),
    ).resolves.toEqual([
      {
        messageId: "user-1",
        role: "user",
        timestamp: "2026-06-25T20:00:01.000Z",
        text: "Inspect the prompt builder.",
        displayParts: [],
        state: "read",
        parts: [],
      },
    ]);
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
    ).toThrow("The registered session belongs to another repository");
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
      "The registered session belongs to another repository",
    );
    expect(() => service.loadSessionTodos(ref)).toThrow(
      "The registered session belongs to another repository",
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
        claudeExecutablePath: "/usr/local/bin/claude",
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
          discoverTool: () => Effect.die("unused"),
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
    const getContextUsage = mock(async () => createClaudeContextUsageResponse(176_005, 272_000));
    const service = createService(
      createSession({
        query: createClaudeQueryFixture({
          close: mock(() => {}),
          getContextUsage,
        }),
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
    const getContextUsage = mock(async () => createClaudeContextUsageResponse(176_005, 272_000));
    const service = createService(
      createSession({
        query: createClaudeQueryFixture({
          close: mock(() => {}),
          getContextUsage,
        }),
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
    const contextRead =
      Promise.withResolvers<ReturnType<typeof createClaudeContextUsageResponse>>();
    const queryClosed = Promise.withResolvers<void>();
    const session = createSession({
      query: createClaudeQueryFixture({
        close: mock(() => queryClosed.resolve()),
        getContextUsage: () => contextRead.promise,
      }),
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

    contextRead.resolve(createClaudeContextUsageResponse(95_000, 200_000));
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

  test("fails the session start before store ownership when the file search prewarm fails", async () => {
    const sessionStore = createClaudeAgentSdkSessionStore({
      now: () => "2026-06-25T20:00:00.000Z",
    });
    const service = createService(null, undefined, sessionStore, {
      fileSearch: {
        prewarm: () => {
          throw new Error("fff native library not found");
        },
        release: () => {},
        search: async () => [],
      },
      resolveMcpBridgeConnection: () =>
        Effect.succeed({
          workspaceId: "workspace-1",
          hostUrl: "http://127.0.0.1:1",
          hostToken: "bridge-secret-value",
        }),
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
    ).rejects.toThrow("fff native library not found");

    expect([...sessionStore.values()]).toEqual([]);
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
    const applyFlagSettings = mock(async () => {});
    const session = createSession({
      model: {
        runtimeKind: "claude",
        providerId: "claude",
        modelId: "claude-opus-4-6",
        variant: "high",
      },
      query: createClaudeQueryFixture({
        applyFlagSettings,
        close: mock(() => {}),
        setModel,
      }),
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

  test("keeps the active Claude profile during a live model update", async () => {
    const session = createSession({
      model: {
        runtimeKind: "claude",
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        variant: "high",
        profileId: "build",
      },
      query: createClaudeQueryFixture({
        applyFlagSettings: mock(async () => {}),
        close: mock(() => {}),
        setModel: mock(async (_model?: string) => {}),
      }),
    });
    const service = createService(session);

    await Effect.runPromise(
      service.updateSessionModel({
        repoPath: "/repo/",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree/",
        externalSessionId: "session-1",
        model: {
          providerId: "claude",
          modelId: "claude-opus-4-6",
          variant: "xhigh",
        },
      }),
    );

    expect(session.model).toEqual({
      providerId: "claude",
      modelId: "claude-opus-4-6",
      variant: "xhigh",
      profileId: "build",
    });
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
      query: createClaudeQueryFixture({
        applyFlagSettings: mock(async () => {}),
        close: mock(() => {}),
        setModel: mock(async (_model?: string) => {}),
      }),
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

describe("continueInterruptedTurn eligibility", () => {
  const continuationInput = {
    repoPath: "/repo/",
    runtimeKind: "claude" as const,
    workingDirectory: "/repo/worktree/",
    externalSessionId: "session-1",
    runtimePolicy: { kind: "claude" as const },
    sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
  };

  const resumeFailureReason = async (operation: Effect.Effect<unknown, unknown, never>) => {
    const failure = await Effect.runPromise(Effect.flip(operation));
    if (!(failure instanceof HostOperationError)) {
      throw new Error(`Expected a host operation failure, received: ${String(failure)}`);
    }
    if (!(failure.cause instanceof InterruptedTurnResumeError)) {
      throw new Error(`Expected a typed resume failure, received: ${String(failure.cause)}`);
    }
    return failure.cause.reason;
  };

  test("reports a missing persisted session as session_not_found", async () => {
    const service = createService(null);

    await expect(
      resumeFailureReason(
        service.continueInterruptedTurn(
          { ...continuationInput, workingDirectory: "/missing-worktree" },
          "runtime-claude",
        ),
      ),
    ).resolves.toBe("session_not_found");
  });

  test("reports a persisted working-directory mismatch as identity_mismatch", () => {
    expect(
      classifyPersistedClaudeContinuationFailure(
        new AgentRuntimeQueryError(
          "scope_mismatch",
          "The Claude session belongs to another working directory. Select the matching session.",
        ),
        "session-1",
      ),
    ).toEqual({
      reason: "identity_mismatch",
      message:
        "Cannot continue Claude session 'session-1': The Claude session belongs to another working directory. Select the matching session.",
    });
  });

  test("keeps an unclassified persisted-history failure as probe_failed", () => {
    expect(
      classifyPersistedClaudeContinuationFailure(
        new Error("transcript store unavailable"),
        "session-1",
      ),
    ).toEqual({
      reason: "probe_failed",
      message:
        "Cannot read the persisted Claude transcript for session 'session-1': transcript store unavailable",
    });
  });

  test("reports a registered-session identity mismatch as identity_mismatch", async () => {
    const service = createService(
      createSession({
        input: {
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/other-worktree/",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: "Build",
        },
      }),
    );

    await expect(
      resumeFailureReason(service.continueInterruptedTurn(continuationInput, "runtime-claude")),
    ).resolves.toBe("identity_mismatch");
  });

  test("refuses a live continuation that waits for pending input", async () => {
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
            resolve: () => {},
          },
        ],
      ]),
    });
    const service = createService(session);

    await expect(
      resumeFailureReason(service.continueInterruptedTurn(continuationInput, "runtime-claude")),
    ).resolves.toBe("waiting_input");
  });

  test("refuses a fresh live session without a user turn as ineligible_turn_state", async () => {
    const service = createService(
      createSession({
        input: {
          repoPath: "/repo/",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree/",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: "Build",
        },
      }),
    );

    await expect(
      resumeFailureReason(service.continueInterruptedTurn(continuationInput, "runtime-claude")),
    ).resolves.toBe("ineligible_turn_state");
  });

  test("keeps the attached session when the replacement continuation cannot start", async () => {
    const sessionStore = createClaudeAgentSdkSessionStore({
      now: () => "2026-06-25T20:00:00.000Z",
    });
    const attached = createSession({
      acceptedUserMessages: [
        {
          messageId: "user-1",
          parts: [],
          text: "Continue.",
          timestamp: "2026-06-25T20:00:01.000Z",
        },
      ],
    });
    const closeSession = mock((target: ClaudeSession) => sessionStore.close(target));
    const service = createService(attached, undefined, {
      ...sessionStore,
      close: closeSession,
    });

    await expect(
      Effect.runPromise(service.continueInterruptedTurn(continuationInput, "runtime-claude")),
    ).rejects.toThrow();

    expect(closeSession).not.toHaveBeenCalled();
    expect(sessionStore.get("session-1")).toBe(attached);
  });

  test("drops an attached stopped session when the replacement continuation cannot start", async () => {
    const sessionStore = createClaudeAgentSdkSessionStore({
      now: () => "2026-06-25T20:00:00.000Z",
    });
    const attached = createSession({
      activity: "stopped",
      acceptedUserMessages: [
        {
          messageId: "user-1",
          parts: [],
          text: "Continue.",
          timestamp: "2026-06-25T20:00:01.000Z",
        },
      ],
    });
    const closeSession = mock((target: ClaudeSession) => sessionStore.close(target));
    const service = createService(attached, undefined, {
      ...sessionStore,
      close: closeSession,
    });

    await expect(
      resumeFailureReason(service.continueInterruptedTurn(continuationInput, "runtime-claude")),
    ).resolves.toBe("session_not_found");

    expect(closeSession).toHaveBeenCalledWith(attached);
    expect(sessionStore.get("session-1")).toBeUndefined();
  });

  test("reads the persisted transcript for a reattached live session before continuing", async () => {
    const service = createService(
      createSession({
        input: {
          repoPath: "/missing-worktree",
          runtimeKind: "claude",
          workingDirectory: "/missing-worktree",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        },
      }),
    );

    await expect(
      resumeFailureReason(
        service.continueInterruptedTurn(
          {
            ...continuationInput,
            repoPath: "/missing-worktree",
            workingDirectory: "/missing-worktree",
          },
          "runtime-claude",
        ),
      ),
    ).resolves.toBe("session_not_found");
  });

  test("accepts a live session whose latest in-process turn is unfinished", async () => {
    const session = createSession({
      acceptedUserMessages: [
        {
          messageId: "user-1",
          parts: [],
          text: "Continue.",
          timestamp: "2026-06-25T20:00:01.000Z",
        },
      ],
    });

    await expect(
      Effect.runPromise(
        checkLiveClaudeContinuationEligibility(
          session,
          continuationInput,
          () => "2026-06-25T20:00:02.000Z",
        ),
      ),
    ).resolves.toBeUndefined();
  });

  test("refuses a live session whose latest in-process turn completed", async () => {
    const session = createSession({
      acceptedUserMessages: [
        {
          messageId: "user-1",
          parts: [],
          text: "Continue.",
          timestamp: "2026-06-25T20:00:01.000Z",
        },
      ],
      lastAssistantTextFinal: true,
      lastAssistantTextTurnIndex: 1,
    });

    await expect(
      resumeFailureReason(
        checkLiveClaudeContinuationEligibility(
          session,
          continuationInput,
          () => "2026-06-25T20:00:02.000Z",
        ),
      ),
    ).resolves.toBe("completed_turn");
  });
});

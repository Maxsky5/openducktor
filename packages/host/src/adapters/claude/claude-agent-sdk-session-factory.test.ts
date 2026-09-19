import { describe, expect, mock, spyOn, test } from "bun:test";
import * as realClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { Effect } from "effect";
import { createArtifactRuntimeDistribution } from "../runtimes/runtime-distribution";
import { claudeSubagentEventSession } from "./claude-agent-sdk-event-session";
import { createClaudeQueryFixture } from "./claude-agent-sdk-session-io.test-support";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";
import type { CreateClaudeAgentSdkServiceInput } from "./claude-agent-sdk-types";

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createToolDiscovery = (): CreateClaudeAgentSdkServiceInput["toolDiscovery"] => ({
  discoverTool: () => Effect.die("unused"),
  resolveTool: () => Effect.die("unused"),
  resolveToolPath: () => Effect.succeed(process.execPath),
  validateToolPath: () => Effect.die("unused"),
});

describe("createClaudeAgentSdkSession", () => {
  test("fails a repository session when the workspace-bound OpenDucktor MCP is disconnected", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      mcpServerStatus: async () => [
        { name: "openducktor", status: "failed", error: "bridge unavailable" },
      ],
      return: async () => {
        streamFinished.resolve();
        return { done: true, value: undefined } as const;
      },
      async *[Symbol.asyncIterator]() {
        await streamFinished.promise;
        yield* [];
      },
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      await expect(
        createClaudeAgentSdkSession({
          emit: () => {},
          input: {
            repoPath: process.cwd(),
            runtimeKind: "claude",
            workingDirectory: process.cwd(),
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "repository" },
            systemPrompt: "Help with this repository",
          },
          initialTodos: [],
          now: () => "2026-06-25T20:00:00.000Z",
          randomId: () => "id",
          resolvedDependencies: {
            claudeExecutablePath: process.execPath,
            mcpBridgeConnection: {
              workspaceId: "workspace-1",
              hostUrl: "http://127.0.0.1:1",
              hostToken: "bridge-secret-value",
            },
            mcpCommand: [process.execPath],
          },
          runtimeId: "runtime-1",
          serviceInput,
          sessionInput: {
            externalSessionId: "session-repository",
            options: { sessionId: "session-repository" },
            startedMessage: "Started repository session",
            title: "Repository session",
          },
          sessionStore,
        }),
      ).rejects.toMatchObject({
        operation: "claudeRuntime.requireOpenDucktorMcp",
        message:
          "OpenDucktor MCP server is not connected for repository Claude session 'session-repository': failed (bridge unavailable).",
      });
      expect(sessionStore.get("session-repository")).toBeUndefined();
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
    }
  });

  test("emits idle after starting an initialized session without a message", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      async *[Symbol.asyncIterator]() {
        await streamFinished.promise;
        yield* [];
      },
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      await expect(
        createClaudeAgentSdkSession({
          emit: (_session, event) => events.push(event),
          input: {
            repoPath: process.cwd(),
            runtimeKind: "claude",
            workingDirectory: process.cwd(),
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
            systemPrompt: "Build",
          },
          initialTodos: [],
          now: () => "2026-06-25T20:00:00.000Z",
          randomId: () => "id",
          resolvedDependencies: {
            claudeExecutablePath: process.execPath,
            mcpBridgeConnection: {
              workspaceId: "workspace-1",
              hostUrl: "http://127.0.0.1:1",
              hostToken: "bridge-secret-value",
            },
            mcpCommand: [process.execPath],
          },
          runtimeId: "runtime-1",
          serviceInput,
          sessionInput: {
            externalSessionId: "session-1",
            options: {},
            startedMessage: "Started build session",
          },
          sessionStore,
        }),
      ).resolves.toMatchObject({
        externalSessionId: "session-1",
        status: "idle",
      });

      expect(events.map((event) => event.type)).toEqual(["session_started", "session_idle"]);
      const session = sessionStore.get("session-1");
      if (!session) {
        throw new Error("Expected initialized session");
      }
      sessionStore.close(session);
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
    }
  });

  test("shares nested transcript state between SDK hooks and session events", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      async *[Symbol.asyncIterator]() {
        await streamFinished.promise;
        yield* [];
      },
    });
    let capturedOptions: realClaudeSdk.Options | undefined;
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(
      (input: Parameters<typeof realClaudeSdk.query>[0]) => {
        capturedOptions = input.options;
        return fakeQuery;
      },
    );

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      await createClaudeAgentSdkSession({
        emit: () => {},
        input: {
          repoPath: process.cwd(),
          runtimeKind: "claude",
          workingDirectory: process.cwd(),
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: "Build",
        },
        initialTodos: [],
        now: () => "2026-06-25T20:00:01.000Z",
        randomId: () => "id",
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        runtimeId: "runtime-1",
        serviceInput,
        sessionInput: {
          externalSessionId: "session-1",
          options: {},
          startedMessage: "Started build session",
        },
        sessionStore,
      });

      const session = sessionStore.get("session-1");
      if (!session) {
        throw new Error("Expected initialized session");
      }
      session.subagentTaskIdsByToolUseId.set("agent-tool-1", "agent-1");
      const postToolUseHook = capturedOptions?.hooks?.PostToolUse?.[0]?.hooks[0];
      if (!postToolUseHook) {
        throw new Error("Expected PostToolUse hook");
      }
      await postToolUseHook(
        {
          hook_event_name: "PostToolUse",
          session_id: "session-1",
          transcript_path: "/home/test/.claude/projects/repo/session-1.jsonl",
          cwd: "/repo",
          agent_id: "agent-1",
          tool_name: "Read",
          tool_use_id: "inner-read-1",
          tool_input: { file_path: "/repo/README.md" },
          tool_response: { file: "/repo/README.md" },
          duration_ms: 250,
        },
        "inner-read-1",
        { signal: new AbortController().signal },
      );

      const childSession = claudeSubagentEventSession(session, "agent-tool-1");
      expect(childSession?.toolStartedAtMsByCallId.get("inner-read-1")).toBe(
        Date.parse("2026-06-25T20:00:00.750Z"),
      );
      expect(childSession?.toolEndedAtMsByCallId?.get("inner-read-1")).toBe(
        Date.parse("2026-06-25T20:00:01.000Z"),
      );
      sessionStore.close(session);
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
    }
  });

  test("fails creation when the SDK stream ends before startup completes", async () => {
    const initialization =
      deferred<Awaited<ReturnType<realClaudeSdk.Query["initializationResult"]>>>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => {},
      initializationResult: () => initialization.promise,
      async *[Symbol.asyncIterator]() {},
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };
      const createPromise = createClaudeAgentSdkSession({
        emit: (_session, event) => events.push(event),
        input: {
          repoPath: process.cwd(),
          runtimeKind: "claude",
          workingDirectory: process.cwd(),
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: "Build",
        },
        initialTodos: [],
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => "id",
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        runtimeId: "runtime-1",
        serviceInput,
        sessionInput: {
          externalSessionId: "session-1",
          options: {},
          startedMessage: "Started build session",
        },
        sessionStore,
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(sessionStore.get("session-1")).toBeUndefined();
      initialization.resolve({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      });

      await expect(createPromise).rejects.toMatchObject({
        operation: "claudeRuntime.createSession",
        message: "Claude session 'session-1' stopped before startup completed.",
      });
      expect(events.some((event) => event.type === "session_started")).toBe(false);
      expect(sessionStore.get("session-1")).toBeUndefined();
    } finally {
      querySpy.mockRestore();
    }
  });

  test("starts a titled fresh session without renaming a transcript that does not exist yet", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      async *[Symbol.asyncIterator]() {
        await streamFinished.promise;
        yield* [];
      },
    });
    const renameSession = mock(async () => {
      throw new Error("fresh sessions must not be renamed before their first message");
    });
    const query = mock((_input: Parameters<typeof realClaudeSdk.query>[0]) => fakeQuery);
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(query);
    const renameSessionSpy = spyOn(realClaudeSdk, "renameSession").mockImplementation(
      renameSession,
    );

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      const summary = await createClaudeAgentSdkSession({
        emit: (_session, event) => events.push(event),
        input: {
          repoPath: process.cwd(),
          runtimeKind: "claude",
          workingDirectory: process.cwd(),
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: "Build",
        },
        initialTodos: [],
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => "id",
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        runtimeId: "runtime-1",
        serviceInput,
        sessionInput: {
          externalSessionId: "session-1",
          options: { sessionId: "session-1" },
          startedMessage: "Started build session",
          title: "Builder",
        },
        sessionStore,
      });

      expect(summary).toMatchObject({
        externalSessionId: "session-1",
        status: "idle",
      });
      expect(query.mock.calls[0]?.[0].options?.title).toBe("Builder");
      expect(renameSession).not.toHaveBeenCalled();
      expect(events.map((event) => event.type)).toEqual(["session_started", "session_idle"]);
      const session = sessionStore.get("session-1");
      if (!session) {
        throw new Error("Expected initialized session");
      }
      sessionStore.close(session);
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
      renameSessionSpy.mockRestore();
    }
  });

  test("reports continuation admission before a resumed session rename fails", async () => {
    const streamFinished = deferred<void>();
    const teardownFinished = deferred<void>();
    const teardownStarted = deferred<void>();
    const renameStarted = deferred<void>();
    const queryReturn = mock(async () => {
      teardownStarted.resolve();
      await teardownFinished.promise;
      return { done: true, value: undefined } as const;
    });
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      async *[Symbol.asyncIterator]() {
        yield claudeSdkMessageFixture({
          type: "system",
          subtype: "session_state_changed",
          state: "running",
          uuid: "7b7fe9e0-fd84-476f-8610-4c9ce2beb135",
          session_id: "session-1",
        });
        await streamFinished.promise;
        yield* [];
      },
      return: queryReturn,
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);
    const renameSessionSpy = spyOn(realClaudeSdk, "renameSession").mockImplementation(async () => {
      renameStarted.resolve();
      throw new Error("rename unavailable");
    });

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const onContinuationAdmission = mock(() => {});
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      const creation = createClaudeAgentSdkSession({
        emit: (_session, event) => events.push(event),
        input: {
          repoPath: process.cwd(),
          runtimeKind: "claude",
          workingDirectory: process.cwd(),
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: "Build",
        },
        initialTodos: [],
        now: () => "2026-06-25T20:00:00.000Z",
        onContinuationAdmission,
        randomId: () => "id",
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        runtimeId: "runtime-1",
        serviceInput,
        sessionInput: {
          externalSessionId: "session-1",
          options: { resume: "session-1" },
          resumeInterruptedTurn: true,
          startedMessage: "Resumed build session",
          title: "Builder",
        },
        sessionStore,
      });
      let creationSettled = false;
      void creation.then(
        () => {
          creationSettled = true;
        },
        () => {
          creationSettled = true;
        },
      );

      await renameStarted.promise;
      await Promise.resolve();
      await Promise.resolve();

      expect(onContinuationAdmission).toHaveBeenCalledTimes(1);
      expect(queryReturn).toHaveBeenCalledTimes(1);
      await teardownStarted.promise;
      expect(creationSettled).toBe(false);

      teardownFinished.resolve();
      await expect(creation).rejects.toThrow("rename unavailable");

      expect(events.some((event) => event.type === "session_started")).toBe(false);
      expect(sessionStore.get("session-1")).toBeUndefined();
    } finally {
      streamFinished.resolve();
      teardownFinished.resolve();
      querySpy.mockRestore();
      renameSessionSpy.mockRestore();
    }
  });

  test("waits for the continuation admission before reporting a running session", async () => {
    const streamFinished = deferred<void>();
    const admissionGate = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      async *[Symbol.asyncIterator]() {
        await admissionGate.promise;
        yield {
          ...claudeSdkMessageFixture({
            type: "user",
            message: { role: "user", content: [{ type: "text", text: "Continue" }] },
            parent_tool_use_id: null,
            session_id: "session-continuation",
            uuid: "94db8937-6c10-4cfe-9aac-7bc9bc72f004",
          }),
          isSynthetic: true,
        };
        yield claudeSdkMessageFixture({
          type: "system",
          subtype: "session_state_changed",
          state: "running",
          uuid: "7b7fe9e0-fd84-476f-8610-4c9ce2beb135",
          session_id: "session-continuation",
        });
        await streamFinished.promise;
        yield* [];
      },
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const onContinuationAdmission = mock(() => {});
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      const creation = createClaudeAgentSdkSession({
        emit: (_session, event) => events.push(event),
        input: {
          repoPath: process.cwd(),
          runtimeKind: "claude",
          workingDirectory: process.cwd(),
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: "Build",
        },
        initialTodos: [],
        now: () => "2026-06-25T20:00:00.000Z",
        onContinuationAdmission,
        randomId: () => "id",
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        runtimeId: "runtime-1",
        serviceInput,
        sessionInput: {
          externalSessionId: "session-continuation",
          options: {},
          resumeInterruptedTurn: true,
          startedMessage: "Continued build session",
        },
        sessionStore,
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(events).toEqual([]);

      admissionGate.resolve();
      await expect(creation).resolves.toMatchObject({
        externalSessionId: "session-continuation",
        status: "running",
      });
      expect(events.map((event) => event.type)).toEqual(["session_started"]);
      expect(onContinuationAdmission).toHaveBeenCalledTimes(1);
      const session = sessionStore.get("session-continuation");
      if (!session) {
        throw new Error("Expected the admitted continuation session");
      }
      expect(session.activity).toBe("running");
      sessionStore.close(session);
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
    }
  });

  test("admits a continuation from the hidden synthetic user turn", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      async *[Symbol.asyncIterator]() {
        yield {
          ...claudeSdkMessageFixture({
            type: "user",
            message: { role: "user", content: [{ type: "text", text: "Continue" }] },
            parent_tool_use_id: null,
            session_id: "session-continuation",
            uuid: "7b7fe9e0-fd84-476f-8610-4c9ce2beb135",
          }),
          isSynthetic: true,
        };
        await streamFinished.promise;
        yield* [];
      },
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      await expect(
        createClaudeAgentSdkSession({
          emit: (_session, event) => events.push(event),
          input: {
            repoPath: process.cwd(),
            runtimeKind: "claude",
            workingDirectory: process.cwd(),
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
            systemPrompt: "Build",
          },
          initialTodos: [],
          now: () => "2026-06-25T20:00:00.000Z",
          randomId: () => "id",
          resolvedDependencies: {
            claudeExecutablePath: process.execPath,
            mcpBridgeConnection: {
              workspaceId: "workspace-1",
              hostUrl: "http://127.0.0.1:1",
              hostToken: "bridge-secret-value",
            },
            mcpCommand: [process.execPath],
          },
          runtimeId: "runtime-1",
          serviceInput,
          sessionInput: {
            externalSessionId: "session-continuation",
            options: {},
            resumeInterruptedTurn: true,
            startedMessage: "Continued build session",
          },
          sessionStore,
        }),
      ).resolves.toMatchObject({
        externalSessionId: "session-continuation",
        status: "running",
      });
      expect(events.map((event) => event.type)).toEqual(["session_started"]);
      const session = sessionStore.get("session-continuation");
      if (!session) {
        throw new Error("Expected the admitted continuation session");
      }
      sessionStore.close(session);
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
    }
  });

  test("refuses a continuation that the runtime never admits", async () => {
    const { awaitClaudeContinuationAdmission } = await import("./claude-agent-sdk-session-factory");

    await expect(
      awaitClaudeContinuationAdmission({
        admission: new Promise<void>(() => {}),
        externalSessionId: "session-continuation",
        runtimeId: "runtime-1",
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({
      operation: "claudeRuntime.createSession",
      message:
        "Claude session 'session-continuation' did not start the interrupted-turn continuation within 5 ms.",
      cause: expect.objectContaining({
        reason: "continuation_failed",
        message:
          "Claude Code did not start the continuation for session 'session-continuation'. Send a new message to continue.",
      }),
    });
  });

  test("reports a continuation failure when the stream ends before admission", async () => {
    const fakeQuery = createClaudeQueryFixture({
      close: () => {},
      return: async () => ({ done: true, value: undefined }),
      async *[Symbol.asyncIterator]() {
        yield* [];
      },
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      await expect(
        createClaudeAgentSdkSession({
          emit: (_session, event) => events.push(event),
          input: {
            repoPath: process.cwd(),
            runtimeKind: "claude",
            workingDirectory: process.cwd(),
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
            systemPrompt: "Build",
          },
          initialTodos: [],
          now: () => "2026-06-25T20:00:00.000Z",
          randomId: () => "id",
          resolvedDependencies: {
            claudeExecutablePath: process.execPath,
            mcpBridgeConnection: {
              workspaceId: "workspace-1",
              hostUrl: "http://127.0.0.1:1",
              hostToken: "bridge-secret-value",
            },
            mcpCommand: [process.execPath],
          },
          runtimeId: "runtime-1",
          serviceInput,
          sessionInput: {
            externalSessionId: "session-continuation",
            options: {},
            resumeInterruptedTurn: true,
            startedMessage: "Continued build session",
          },
          sessionStore,
        }),
      ).rejects.toMatchObject({
        operation: "claudeRuntime.createSession",
        message:
          "Claude session 'session-continuation' ended before it admitted the interrupted-turn continuation.",
        cause: expect.objectContaining({ reason: "continuation_failed" }),
      });

      expect(sessionStore.get("session-continuation")).toBeUndefined();
      expect(events.some((event) => event.type === "session_started")).toBe(false);
      expect(
        events.some((event) => event.type === "session_finished" || event.type === "session_error"),
      ).toBe(false);
    } finally {
      querySpy.mockRestore();
    }
  });
});

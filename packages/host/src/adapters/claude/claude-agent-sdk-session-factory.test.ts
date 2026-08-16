import { describe, expect, mock, test } from "bun:test";
import * as realClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { Effect } from "effect";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
import { createArtifactRuntimeDistribution } from "../runtimes/runtime-distribution";
import { claudeSubagentEventSession } from "./claude-agent-sdk-event-session";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
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
    const fakeQuery = {
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
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await streamFinished.promise;
          return { done: true, value: undefined };
        },
      }),
    } as unknown as realClaudeSdk.Query;
    mock.module("@anthropic-ai/claude-agent-sdk", () => ({
      ...realClaudeSdk,
      query: () => fakeQuery,
    }));

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        settingsConfig: createFixedRuntimeSettingsConfig("claude", process.execPath),
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
      mock.module("@anthropic-ai/claude-agent-sdk", () => realClaudeSdk);
    }
  });

  test("emits idle after starting an initialized session without a message", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = {
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await streamFinished.promise;
          return { done: true, value: undefined };
        },
      }),
    } as unknown as realClaudeSdk.Query;
    mock.module("@anthropic-ai/claude-agent-sdk", () => ({
      ...realClaudeSdk,
      query: () => fakeQuery,
    }));

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        settingsConfig: createFixedRuntimeSettingsConfig("claude", process.execPath),
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
      mock.module("@anthropic-ai/claude-agent-sdk", () => realClaudeSdk);
    }
  });

  test("shares nested transcript state between SDK hooks and session events", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = {
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await streamFinished.promise;
          return { done: true, value: undefined };
        },
      }),
    } as unknown as realClaudeSdk.Query;
    let capturedOptions: realClaudeSdk.Options | undefined;
    mock.module("@anthropic-ai/claude-agent-sdk", () => ({
      ...realClaudeSdk,
      query: (input: Parameters<typeof realClaudeSdk.query>[0]) => {
        capturedOptions = input.options;
        return fakeQuery;
      },
    }));

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        settingsConfig: createFixedRuntimeSettingsConfig("claude", process.execPath),
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
      mock.module("@anthropic-ai/claude-agent-sdk", () => realClaudeSdk);
    }
  });

  test("fails creation when the SDK stream ends before startup completes", async () => {
    const initialization =
      deferred<Awaited<ReturnType<realClaudeSdk.Query["initializationResult"]>>>();
    const fakeQuery = {
      close: () => {},
      initializationResult: () => initialization.promise,
      async *[Symbol.asyncIterator]() {},
    } as unknown as realClaudeSdk.Query;
    mock.module("@anthropic-ai/claude-agent-sdk", () => ({
      ...realClaudeSdk,
      query: () => fakeQuery,
    }));

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        settingsConfig: createFixedRuntimeSettingsConfig("claude", process.execPath),
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
      mock.module("@anthropic-ai/claude-agent-sdk", () => realClaudeSdk);
    }
  });

  test("starts a titled fresh session without renaming a transcript that does not exist yet", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = {
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await streamFinished.promise;
          return { done: true, value: undefined };
        },
      }),
    } as unknown as realClaudeSdk.Query;
    const renameSession = mock(async () => {
      throw new Error("fresh sessions must not be renamed before their first message");
    });
    const query = mock((_input: Parameters<typeof realClaudeSdk.query>[0]) => fakeQuery);
    mock.module("@anthropic-ai/claude-agent-sdk", () => ({
      ...realClaudeSdk,
      query,
      renameSession,
    }));

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        settingsConfig: createFixedRuntimeSettingsConfig("claude", process.execPath),
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
      mock.module("@anthropic-ai/claude-agent-sdk", () => realClaudeSdk);
    }
  });

  test("fails creation when renaming a resumed Claude session fails", async () => {
    const streamFinished = deferred<void>();
    const teardownFinished = deferred<void>();
    const teardownStarted = deferred<void>();
    const renameStarted = deferred<void>();
    const queryReturn = mock(async () => {
      teardownStarted.resolve();
      await teardownFinished.promise;
      return { done: true, value: undefined } as const;
    });
    const fakeQuery = {
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await streamFinished.promise;
          return { done: true, value: undefined };
        },
      }),
      return: queryReturn,
    } as unknown as realClaudeSdk.Query;
    mock.module("@anthropic-ai/claude-agent-sdk", () => ({
      ...realClaudeSdk,
      query: () => fakeQuery,
      renameSession: async () => {
        renameStarted.resolve();
        throw new Error("rename unavailable");
      },
    }));

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        settingsConfig: createFixedRuntimeSettingsConfig("claude", process.execPath),
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
      mock.module("@anthropic-ai/claude-agent-sdk", () => realClaudeSdk);
    }
  });
});

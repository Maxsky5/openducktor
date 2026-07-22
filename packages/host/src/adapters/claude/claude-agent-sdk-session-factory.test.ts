import { describe, expect, mock, test } from "bun:test";
import * as realClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { Effect } from "effect";
import { createArtifactRuntimeDistribution } from "../runtimes/runtime-distribution";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import type { CreateClaudeAgentSdkServiceInput } from "./claude-agent-sdk-types";

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("createClaudeAgentSdkSession", () => {
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
        toolDiscovery: {
          resolveTool: () => Effect.die("unused"),
          resolveToolPath: () => Effect.succeed(process.execPath),
        },
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
});

import { describe, expect, test } from "bun:test";
import type { Options, SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import {
  buildClaudeExecutableProbeOptions,
  createClaudeExecutableProbe,
} from "./claude-executable-probe";

const initializationResponse = (): SDKControlInitializeResponse => ({
  commands: [],
  agents: [],
  output_style: "default",
  available_output_styles: [],
  models: [],
  account: {},
  claude_code_version: "2.1.306",
});

describe("createClaudeExecutableProbe", () => {
  test("uses an isolated Agent SDK initialization and awaits cleanup after success", async () => {
    let receivedOptions: Options | null = null;
    let cleanupStarted = false;
    let confirmCleanupStarted = (): void => undefined;
    let releaseCleanup = (): void => undefined;
    const cleanupStartedSignal = new Promise<void>((resolve) => {
      confirmCleanupStarted = resolve;
    });
    const cleanupBlocked = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const probe = createClaudeExecutableProbe({
      readEnv: () => ({ PATH: "/usr/bin" }),
      queryFactory(input) {
        receivedOptions = input.options;
        return {
          initializationResult: async () => initializationResponse(),
          async return() {
            cleanupStarted = true;
            confirmCleanupStarted();
            await cleanupBlocked;
            return { done: true, value: undefined };
          },
        };
      },
    });

    let probeResolved = false;
    const probing = Effect.runPromise(probe.probeExecutable("/usr/local/bin/claude")).then(() => {
      probeResolved = true;
    });
    await Effect.runPromise(
      Effect.promise(() => cleanupStartedSignal).pipe(Effect.timeout("1 second")),
    );

    expect(receivedOptions).toMatchObject({
      allowedTools: [],
      env: {
        PATH: "/usr/bin",
        CLAUDE_AGENT_SDK_CLIENT_APP: "openducktor/runtime-probe",
        ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      },
      mcpServers: {},
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      tools: [],
    });
    expect(cleanupStarted).toBe(true);
    expect(probeResolved).toBe(false);

    releaseCleanup();
    await probing;
    expect(probeResolved).toBe(true);
  });

  test("preserves operational Agent SDK initialization failures", async () => {
    let cleanupFinished = false;
    const probe = createClaudeExecutableProbe({
      queryFactory() {
        return {
          initializationResult: () => Promise.reject(new Error("failed to start Claude Code")),
          async return() {
            await Promise.resolve();
            cleanupFinished = true;
            return { done: true, value: undefined };
          },
        };
      },
    });

    const failure = await Effect.runPromise(
      Effect.flip(probe.probeExecutable("/usr/local/bin/claude")),
    );

    expect(failure._tag).toBe("HostOperationError");
    if (failure._tag !== "HostOperationError") {
      throw new Error(`Expected HostOperationError, received ${failure._tag}`);
    }
    expect(failure.operation).toBe("claudeExecutableProbe.initialize");
    expect(failure.message).toContain("failed to start Claude Code");
    expect(cleanupFinished).toBe(true);
  });

  test("rejects an initialization response without the Claude protocol shape", async () => {
    const probe = createClaudeExecutableProbe({
      queryFactory() {
        return {
          // @ts-expect-error This malformed response verifies protocol validation.
          initializationResult: async (): Promise<SDKControlInitializeResponse> => ({}),
          async return() {
            return { done: true, value: undefined };
          },
        };
      },
    });

    const failure = await Effect.runPromise(
      Effect.flip(probe.probeExecutable("/usr/local/bin/not-claude")),
    );

    expect(failure._tag).toBe("RuntimeExecutableIncompatibleError");
  });

  test.each([undefined, "not-a-version", "2.1.305", "2.0.999", "1.99.999"])(
    "rejects unsupported native version %s and closes the query",
    async (version) => {
      let closed = false;
      const initialization = initializationResponse();
      if (version === undefined) delete initialization.claude_code_version;
      else initialization.claude_code_version = version;
      const probe = createClaudeExecutableProbe({
        queryFactory() {
          return {
            initializationResult: async () => initialization,
            async return() {
              closed = true;
              return { done: true, value: undefined };
            },
          };
        },
      });

      const result = await Effect.runPromise(
        Effect.result(probe.probeExecutable("/usr/local/bin/claude")),
      );

      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure") throw new Error("Expected an incompatible executable.");
      expect(result.failure._tag).toBe("RuntimeExecutableIncompatibleError");
      expect(result.failure.message).toContain("2.1.306 or later");
      expect(result.failure.message).toContain("/usr/local/bin/claude");
      expect(result.failure.message).toContain("Update Claude Code");
      expect(closed).toBe(true);
    },
  );

  test.each(["2.1.307", "2.2.0", "3.0.0"])(
    "accepts compatible native version %s",
    async (version) => {
      const probe = createClaudeExecutableProbe({
        queryFactory() {
          return {
            initializationResult: async () => ({
              ...initializationResponse(),
              claude_code_version: version,
            }),
            async return() {
              return { done: true, value: undefined };
            },
          };
        },
      });

      await Effect.runPromise(probe.probeExecutable("/usr/local/bin/claude"));
    },
  );

  test("preserves Agent SDK cleanup failures", async () => {
    const probe = createClaudeExecutableProbe({
      queryFactory() {
        return {
          initializationResult: async () => initializationResponse(),
          return: () => Promise.reject(new Error("cleanup failed")),
        };
      },
    });

    const failure = await Effect.runPromise(
      Effect.flip(probe.probeExecutable("/usr/local/bin/claude")),
    );

    expect(failure._tag).toBe("HostOperationError");
    if (failure._tag !== "HostOperationError") {
      throw new Error(`Expected HostOperationError, received ${failure._tag}`);
    }
    expect(failure.operation).toBe("claudeExecutableProbe.cleanup");
    expect(failure.message).toContain("cleanup failed");
  });
});

describe("buildClaudeExecutableProbeOptions", () => {
  test("uses the selected executable without loading user, project, tool, or MCP config", () => {
    const abortController = new AbortController();

    const options = buildClaudeExecutableProbeOptions({
      executablePath: "/opt/claude",
      processEnv: {},
      abortController,
    });

    expect(options.pathToClaudeCodeExecutable).toBe("/opt/claude");
    expect(options.abortController).toBe(abortController);
    expect(options.settingSources).toEqual([]);
    expect(options.tools).toEqual([]);
    expect(options.mcpServers).toEqual({});
    expect(options.persistSession).toBe(false);
  });
});

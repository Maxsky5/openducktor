import { describe, expect, test } from "bun:test";
import type { Options, SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import {
  buildClaudeExecutableProbeOptions,
  createClaudeExecutableProbe,
} from "./claude-executable-probe";

// SAFETY: This test controls the fixture and supplies `SDKControlInitializeResponse` used by this case.
const initializationResponse = (): SDKControlInitializeResponse =>
  ({
    commands: [],
    agents: [],
    output_style: "default",
    available_output_styles: [],
    models: [],
    account: {},
  }) as SDKControlInitializeResponse;

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
      processEnv: { PATH: "/usr/bin" },
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
        // SAFETY: This test controls the fixture and supplies `SDKControlInitializeResponse` used by this case.
        return {
          initializationResult: async () => ({}) as SDKControlInitializeResponse,
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

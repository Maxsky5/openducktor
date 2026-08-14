import { describe, expect, test } from "bun:test";
import type { Options, SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import {
  buildClaudeExecutableProbeOptions,
  createClaudeExecutableProbe,
} from "./claude-executable-probe";

describe("createClaudeExecutableProbe", () => {
  test("uses an isolated Agent SDK initialization and closes it after success", async () => {
    let receivedOptions: Options | null = null;
    let closed = false;
    const probe = createClaudeExecutableProbe({
      processEnv: { PATH: "/usr/bin" },
      queryFactory(input) {
        receivedOptions = input.options;
        return {
          initializationResult: async () => ({}) as SDKControlInitializeResponse,
          close() {
            closed = true;
          },
        };
      },
    });

    await Effect.runPromise(probe.probeExecutable("/usr/local/bin/claude"));

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
    expect(closed).toBe(true);
  });

  test("closes the Agent SDK query when initialization fails", async () => {
    let closed = false;
    const probe = createClaudeExecutableProbe({
      queryFactory() {
        return {
          initializationResult: () => Promise.reject(new Error("not Claude Code")),
          close() {
            closed = true;
          },
        };
      },
    });

    const exit = await Effect.runPromiseExit(probe.probeExecutable("/usr/local/bin/not-claude"));

    expect(exit._tag).toBe("Failure");
    expect(closed).toBe(true);
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

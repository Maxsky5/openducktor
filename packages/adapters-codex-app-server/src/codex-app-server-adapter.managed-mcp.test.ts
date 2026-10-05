import { describe, expect, test } from "bun:test";
import { ODT_MCP_TOOL_NAMES } from "@openducktor/contracts";
import {
  AGENT_ROLE_TOOL_POLICY,
  type PolicyBoundSessionRef,
  workflowAgentSessionScope,
} from "@openducktor/core";
import {
  codexStartSessionInput,
  createHarness,
  defaultCodexEffectivePolicy,
  expectedThreadConfig,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";
import type { CodexJsonRpcRequest } from "./types";

const THREAD_METHODS = new Set(["thread/start", "thread/resume", "thread/fork"]);
const runtimePolicy = () => ({ kind: "codex" as const, policy: defaultCodexEffectivePolicy() });
const buildScope = () => workflowAgentSessionScope("task-1", "build");

/** Reports each thread in the directory where the test opened it. */
class DirectoryTransport extends RecordingTransport {
  readonly cwdByThread = new Map<string, string>();

  override async request(input: CodexJsonRpcRequest) {
    const result = await super.request(input);
    if (!THREAD_METHODS.has(input.method) && input.method !== "thread/read") {
      return result;
    }
    if (!("thread" in result)) {
      return result;
    }
    const requestedCwd = "cwd" in input.params ? input.params.cwd : undefined;
    const cwd = this.cwdByThread.get(result.thread.id) ?? requestedCwd;
    if (!cwd) {
      return result;
    }
    // The fixture builds a new result for each request, so the patch stays local.
    this.cwdByThread.set(result.thread.id, cwd);
    result.thread.cwd = cwd;
    if ("cwd" in result) {
      result.cwd = cwd;
    }
    return result;
  }
}

const sessionRef = (
  repoPath: string,
  externalSessionId: string,
  sessionScope: PolicyBoundSessionRef["sessionScope"] = buildScope(),
): PolicyBoundSessionRef => ({
  repoPath,
  runtimeKind: "codex",
  workingDirectory: repoPath,
  externalSessionId,
  sessionScope,
  runtimePolicy: runtimePolicy(),
});

const threadConfigs = (transport: RecordingTransport) =>
  transport.calls
    .filter((call) => THREAD_METHODS.has(call.method))
    .map((call) => ({
      method: call.method,
      config: "config" in call.params ? call.params.config : undefined,
    }));

describe("CodexAppServerAdapter managed MCP binding", () => {
  test("binds the session workspace MCP server on every thread request of one shared runtime", async () => {
    const transport = new DirectoryTransport("runtime-live", false);
    transport.cwdByThread.set("native-a", "/repo-a");
    transport.cwdByThread.set("import-b", "/repo-b");
    transport.cwdByThread.set("detached-a", "/repo-a");
    transport.cwdByThread.set("thread-idle", "/repo-b");
    const { adapter } = createHarness({ transportFactory: () => transport });
    const model = { providerId: "openai", modelId: "gpt-5", variant: "medium" };
    const repositoryScope = { kind: "repository" as const };

    await adapter.startSession(
      codexStartSessionInput({ repoPath: "/repo-a", workingDirectory: "/repo-a" }),
    );
    await adapter.forkSession({
      ...sessionRef("/repo-b", "unused"),
      parentExternalSessionId: "parent-b",
      systemPrompt: "Use the repo rules.",
      model,
    });
    await adapter.resumeSession({
      ...sessionRef("/repo-b", "thread-b"),
      systemPrompt: "Use the repo rules.",
      model,
    });
    await adapter.resumeSession(sessionRef("/repo-a", "native-a", repositoryScope));
    await adapter.openExistingSession(sessionRef("/repo-b", "import-b", repositoryScope));
    await adapter.sendUserMessage({
      ...sessionRef("/repo-a", "detached-a"),
      systemPrompt: "Use the repo rules.",
      parts: [{ kind: "text", text: "Continue" }],
    });
    await adapter.loadSessionContextUsage(sessionRef("/repo-b", "thread-idle"));

    const workflowA = expectedThreadConfig("/repo-a", AGENT_ROLE_TOOL_POLICY.build);
    const workflowB = expectedThreadConfig("/repo-b", AGENT_ROLE_TOOL_POLICY.build);
    expect(threadConfigs(transport)).toEqual([
      { method: "thread/start", config: workflowA },
      { method: "thread/fork", config: workflowB },
      { method: "thread/resume", config: workflowB },
      { method: "thread/resume", config: expectedThreadConfig("/repo-a", ODT_MCP_TOOL_NAMES) },
      { method: "thread/resume", config: expectedThreadConfig("/repo-b", ODT_MCP_TOOL_NAMES) },
      { method: "thread/resume", config: workflowA },
      { method: "thread/resume", config: workflowB },
    ]);
    expect(workflowA["mcp_servers.openducktor.env"].ODT_WORKSPACE_ID).not.toBe(
      workflowB["mcp_servers.openducktor.env"].ODT_WORKSPACE_ID,
    );
    await adapter.releaseRuntime("runtime-live");
  });

  test("never sends the process-wide env_vars forwarding or a parent MCP table", async () => {
    const transport = new RecordingTransport("runtime-live", false);
    const { adapter } = createHarness({ transportFactory: () => transport });

    await adapter.startSession(codexStartSessionInput());

    const [start] = threadConfigs(transport);
    expect(Object.keys(start?.config ?? {}).sort()).toEqual([
      "mcp_servers.openducktor.args",
      "mcp_servers.openducktor.command",
      "mcp_servers.openducktor.default_tools_approval_mode",
      "mcp_servers.openducktor.enabled",
      "mcp_servers.openducktor.enabled_tools",
      "mcp_servers.openducktor.env",
      "mcp_servers.openducktor.required",
    ]);
    await adapter.releaseRuntime("runtime-live");
  });

  test("fails thread requests when the workspace MCP server cannot be resolved", async () => {
    const transport = new DirectoryTransport("runtime-live", false);
    transport.cwdByThread.set("native-b", "/repo-b");
    const resolvedRepos: string[] = [];
    const { adapter } = createHarness({
      transportFactory: () => transport,
      resolveManagedMcpServer: async (repoPath) => {
        resolvedRepos.push(repoPath);
        throw new Error("The MCP host bridge is not running. Check the MCP bridge in Diagnostics.");
      },
    });

    await expect(
      adapter.startSession(
        codexStartSessionInput({ repoPath: "/repo-a", workingDirectory: "/repo-a" }),
      ),
    ).rejects.toThrow(
      "Cannot configure OpenDucktor workflow tools for repository '/repo-a': The MCP host bridge is not running. Check the MCP bridge in Diagnostics.",
    );
    await expect(
      adapter.resumeSession(sessionRef("/repo-b", "native-b", { kind: "repository" })),
    ).rejects.toThrow("Cannot configure OpenDucktor workflow tools for repository '/repo-b'");

    expect(resolvedRepos).toEqual(["/repo-a", "/repo-b"]);
    expect(threadConfigs(transport)).toEqual([]);
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
    await adapter.releaseRuntime("runtime-live");
  });
});

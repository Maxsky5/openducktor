import { describe, expect, mock, test } from "bun:test";
import { resolveCodexEffectivePolicy } from "@openducktor/contracts";
import {
  codexSessionRef,
  codexSessionRuntimeRef,
  codexUserMessageInput,
  createAdapterWithTransport,
  createHarness,
  defaultCodexEffectivePolicy,
  defaultCodexRuntimeConfig,
  flushCodexAdapterWork,
  makeRuntimeSummary,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";
import { codexSandboxPolicy } from "./codex-session-policy";
import { CodexAppServerAdapter } from "./index";

class NameFailingTransport extends RecordingTransport {
  async request<Response>(
    request: Parameters<RecordingTransport["request"]>[0],
  ): Promise<Response> {
    if (request.method === "thread/name/set") {
      this.calls.push(request);
      throw new Error("name failed");
    }
    return super.request<Response>(request);
  }
}

const localSessions = (
  adapter: CodexAppServerAdapter,
): { has(externalSessionId: string): boolean } =>
  (adapter as unknown as { localSessions: { has(externalSessionId: string): boolean } })
    .localSessions;
const expectedThreadPolicy = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandbox: "workspace-write",
};
const expectedTurnPolicy = (workingDirectory: string) => ({
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandboxPolicy: codexSandboxPolicy(defaultCodexEffectivePolicy(), workingDirectory),
});
const codexPolicy = (
  config: ReturnType<typeof defaultCodexRuntimeConfig>,
  role: "build" | "spec",
) => ({
  kind: "codex" as const,
  policy: resolveCodexEffectivePolicy(config, role),
});

describe("CodexAppServerAdapter lifecycle", () => {
  test("prepares one host-owned event subscription per runtime", async () => {
    const subscribeEvents = mock(async () => () => undefined);
    const { adapter } = createHarness({ subscribeEvents });

    await Promise.all([
      adapter.prepareRuntime("runtime-live"),
      adapter.prepareRuntime("runtime-live"),
      adapter.prepareRuntime("runtime-live"),
    ]);

    expect(subscribeEvents).toHaveBeenCalledTimes(1);
    expect(subscribeEvents).toHaveBeenCalledWith("runtime-live", expect.any(Function));
  });

  test("rejects host runtime preparation when live event transport is unavailable", async () => {
    const { adapter } = createHarness({ subscribeEvents: undefined });

    await expect(adapter.prepareRuntime("runtime-live")).rejects.toThrow(
      "Cannot prepare Codex runtime 'runtime-live' because live event subscription is unavailable.",
    );
  });

  test("attempts every runtime-state cleanup when one component fails", () => {
    const { adapter } = createHarness();
    const cleanupCalls: string[] = [];
    const internals = adapter as unknown as {
      localSessions: { releaseRuntime(runtimeId: string): void };
      pendingInput: { clearRuntime(runtimeId: string): void };
      subagents: { clearRuntime(runtimeId: string): void };
      runtimeEvents: { clearRuntime(runtimeId: string): void };
      clearThreadInventory(runtimeId: string): void;
    };
    internals.localSessions.releaseRuntime = (runtimeId) => {
      cleanupCalls.push(`sessions:${runtimeId}`);
      throw new Error("unsubscribe failed");
    };
    internals.pendingInput.clearRuntime = (runtimeId) => {
      cleanupCalls.push(`pending:${runtimeId}`);
    };
    internals.subagents.clearRuntime = (runtimeId) => {
      cleanupCalls.push(`subagents:${runtimeId}`);
    };
    internals.runtimeEvents.clearRuntime = (runtimeId) => {
      cleanupCalls.push(`events:${runtimeId}`);
    };
    internals.clearThreadInventory = (runtimeId) => {
      cleanupCalls.push(`inventory:${runtimeId}`);
    };

    expect(() => adapter.releaseRuntime("runtime-live")).toThrow("unsubscribe failed");
    expect(cleanupCalls).toEqual([
      "sessions:runtime-live",
      "pending:runtime-live",
      "subagents:runtime-live",
      "events:runtime-live",
      "inventory:runtime-live",
    ]);
  });

  test("supports read-only construction without renderer-owned live event plumbing", async () => {
    const transport = new RecordingTransport("runtime-live", false);
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        requireRepoRuntime: async () => makeRuntimeSummary("runtime-live"),
      },
      transportFactory: () => transport,
    });

    const catalog = await adapter.listAvailableModels({
      repoPath: "/repo",
      runtimeKind: "codex",
    });

    expect(catalog.runtime?.kind).toBe("codex");
    expect(transport.calls.map((call) => call.method)).toEqual(["model/list"]);
  });

  test("returns the Codex runtime definition", () => {
    const { adapter } = createHarness();

    expect(adapter.getRuntimeDefinition().kind).toBe("codex");
    expect(adapter.listRuntimeDefinitions()).toEqual([adapter.getRuntimeDefinition()]);
  });

  test("starts a session through the live runtime id", async () => {
    const { adapter, transports, requireRepoRuntime } = createHarness();

    const summary = await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    expect(summary.externalSessionId).toBe("thread/start-runtime-live");
    expect(summary.runtimeKind).toBe("codex");
    expect(summary.workingDirectory).toBe("/repo");
    expect(summary.title).toBe("BUILD task-1");
    expect(requireRepoRuntime).toHaveBeenCalledTimes(1);
    expect(transports.has("runtime-live")).toBe(true);
    expect(transports.get("runtime-live")?.calls.map((call) => call.method)).toEqual([
      "model/list",
      "thread/start",
      "thread/name/set",
    ]);
    expect(transports.get("runtime-live")?.calls[1]).toEqual({
      method: "thread/start",
      params: {
        ...expectedThreadPolicy,
        cwd: "/repo",
        developerInstructions: "Use the repo rules.",
        model: "gpt-5",
        effort: "medium",
      },
    });
    expect(transports.get("runtime-live")?.calls[2]).toEqual({
      method: "thread/name/set",
      params: {
        threadId: "thread/start-runtime-live",
        name: "BUILD task-1",
      },
    });
  });

  test("keeps started sessions addressable when thread naming fails", async () => {
    const transport = new NameFailingTransport("runtime-live", false);
    const adapter = createAdapterWithTransport(transport);

    await expect(
      adapter.startSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        systemPrompt: "Use the repo rules.",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    ).rejects.toThrow("name failed");

    expect(localSessions(adapter).has("thread/start-runtime-live")).toBe(true);
    expect(transport.calls.map((call) => call.method)).toEqual([
      "model/list",
      "thread/start",
      "thread/name/set",
    ]);
  });

  test("caches Codex model lists per runtime", async () => {
    const { adapter, transports } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        parts: [{ kind: "text", text: "Continue" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    const transport = transports.get("runtime-live");
    expect(transport?.calls.filter((call) => call.method === "model/list")).toHaveLength(1);
  });

  test("lists models through the required live runtime id", async () => {
    const { adapter, transports, requireRepoRuntime } = createHarness();

    const catalog = await adapter.listAvailableModels({ repoPath: "/repo", runtimeKind: "codex" });

    expect(catalog.runtime?.kind).toBe("codex");
    expect(requireRepoRuntime).toHaveBeenCalledTimes(1);
    expect(transports.has("runtime-live")).toBe(true);
    expect(transports.get("runtime-live")?.calls.map((call) => call.method)).toEqual([
      "model/list",
    ]);
  });

  test("resumes and forks sessions through the live runtime id", async () => {
    const logSessionPolicy = mock(() => {});
    const { adapter, transports, requireRepoRuntime } = createHarness({ logSessionPolicy });

    await adapter.resumeSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "planner" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Carry forward the plan.",
      externalSessionId: "thread-9",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const forkSummary = await adapter.forkSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "qa" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Review the fork.",
      parentExternalSessionId: "thread-7",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    expect(requireRepoRuntime).toHaveBeenCalledTimes(2);
    expect(forkSummary.title).toBe("QA task-1");
    expect(transports.get("runtime-live")?.calls.map((call) => call.method)).toEqual([
      "model/list",
      "thread/resume",
      "thread/fork",
      "thread/name/set",
    ]);
    expect(transports.get("runtime-live")?.calls[1]?.params).toEqual({
      ...expectedThreadPolicy,
      threadId: "thread-9",
      cwd: "/repo",
      developerInstructions: "Carry forward the plan.",
      model: "gpt-5",
      effort: "medium",
    });
    expect(transports.get("runtime-live")?.calls[2]?.params).toEqual({
      ...expectedThreadPolicy,
      threadId: "thread-7",
      cwd: "/repo",
      developerInstructions: "Review the fork.",
      model: "gpt-5",
      effort: "medium",
    });
    expect(transports.get("runtime-live")?.calls[3]).toEqual({
      method: "thread/name/set",
      params: {
        threadId: "thread/fork-runtime-live",
        name: "QA task-1",
      },
    });
    expect(logSessionPolicy).toHaveBeenNthCalledWith(1, {
      operation: "thread/resume",
      runtimeId: "runtime-live",
      threadId: "thread-9",
      workingDirectory: "/repo",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      promptReviewer: "user",
      networkAccess: false,
    });
    expect(logSessionPolicy).toHaveBeenNthCalledWith(2, {
      operation: "thread/fork",
      runtimeId: "runtime-live",
      threadId: "thread-7",
      workingDirectory: "/repo",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      promptReviewer: "user",
      networkAccess: false,
    });
  });

  test("sends user parts through turn/start on the live runtime id", async () => {
    const { adapter, transports } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        parts: [{ kind: "text", text: "Hello Codex" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(transports.get("runtime-live")?.calls.map((call) => call.method)).toEqual([
      "model/list",
      "thread/start",
      "thread/name/set",
      "turn/start",
    ]);
    expect(transports.get("runtime-live")?.calls[3]).toEqual({
      method: "turn/start",
      params: {
        ...expectedTurnPolicy("/repo"),
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Hello Codex" }],
        model: "gpt-5",
        effort: "medium",
      },
    });
  });

  test("applies Codex role overrides to thread/start and turn/start", async () => {
    const { adapter, transports } = createHarness();
    const config = defaultCodexRuntimeConfig();
    config.roleOverrides.build = {
      approvalPolicy: "untrusted",
      approvalsReviewer: "auto_review",
      commandNetworkAccess: true,
    };
    const runtimePolicy = codexPolicy(config, "build");

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy,
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy,
        parts: [{ kind: "text", text: "Build it" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(transports.get("runtime-live")?.calls[1]?.params).toEqual({
      approvalPolicy: "untrusted",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
      cwd: "/repo",
      developerInstructions: "Use the repo rules.",
      model: "gpt-5",
      effort: "medium",
    });
    expect(transports.get("runtime-live")?.calls[3]?.params).toEqual({
      approvalPolicy: "untrusted",
      approvalsReviewer: "auto_review",
      sandboxPolicy: codexSandboxPolicy(runtimePolicy.policy, "/repo"),
      threadId: "thread/start-runtime-live",
      input: [{ type: "text", text: "Build it" }],
      model: "gpt-5",
      effort: "medium",
    });
  });

  test("logs effective Codex policy for session and turn requests", async () => {
    const logSessionPolicy = mock(() => {});
    const { adapter } = createHarness({ logSessionPolicy });
    const config = defaultCodexRuntimeConfig();
    config.roleOverrides.build = {
      approvalPolicy: "untrusted",
      approvalsReviewer: "auto_review",
      commandNetworkAccess: true,
    };
    const runtimePolicy = codexPolicy(config, "build");

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy,
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy,
        parts: [{ kind: "text", text: "Build it" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(logSessionPolicy).toHaveBeenNthCalledWith(1, {
      operation: "thread/start",
      runtimeId: "runtime-live",
      workingDirectory: "/repo",
      sandboxMode: "workspace-write",
      approvalPolicy: "untrusted",
      promptReviewer: "auto_review",
      networkAccess: true,
    });
    expect(logSessionPolicy).toHaveBeenNthCalledWith(2, {
      operation: "turn/start",
      runtimeId: "runtime-live",
      threadId: "thread/start-runtime-live",
      workingDirectory: "/repo",
      sandboxMode: "workspace-write",
      approvalPolicy: "untrusted",
      promptReviewer: "auto_review",
      networkAccess: true,
    });
  });

  test("sends the configured reviewer even when approval policy never makes it display-only", async () => {
    const config = {
      ...defaultCodexRuntimeConfig(),
      defaults: {
        ...defaultCodexRuntimeConfig().defaults,
        approvalPolicy: "never" as const,
        approvalsReviewer: "auto_review" as const,
      },
    };
    const { adapter, transports } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: codexPolicy(config, "build"),
      systemPrompt: "Spec it.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    expect(config.defaults.approvalPolicy).toBe("never");
    expect(transports.get("runtime-live")?.calls[1]?.params).toMatchObject({
      approvalPolicy: "never",
      approvalsReviewer: "auto_review",
    });
  });

  test("adjusts inherited build read-only defaults to workspace-write", async () => {
    const { adapter, transports } = createHarness();

    await adapter.resumeSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Resume build.",
      externalSessionId: "thread-9",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread-9",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        parts: [{ kind: "text", text: "Continue build" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(transports.get("runtime-live")?.calls[1]?.params).toMatchObject({
      sandbox: "workspace-write",
    });
    expect(transports.get("runtime-live")?.calls[2]?.params).toMatchObject({
      sandboxPolicy: codexSandboxPolicy(defaultCodexEffectivePolicy(), "/repo"),
    });
  });

  test("maps explicit spec read-only policy to no writable roots for turns", async () => {
    const { adapter, transports } = createHarness();
    const config = defaultCodexRuntimeConfig();
    config.defaults.commandNetworkAccess = true;
    config.roleOverrides.spec = { sandboxMode: "read-only" };
    const runtimePolicy = codexPolicy(config, "spec");

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" },
      runtimePolicy,
      systemPrompt: "Spec it.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" },
        runtimePolicy,
        parts: [{ kind: "text", text: "Continue spec" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );

    expect(transports.get("runtime-live")?.calls[1]?.params).toMatchObject({
      sandbox: "read-only",
    });
    expect(transports.get("runtime-live")?.calls[3]?.params).toMatchObject({
      sandboxPolicy: { type: "readOnly", networkAccess: true },
    });
  });

  test("fails existing-session send without a model selection", async () => {
    const { adapter } = createHarness();

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread-without-model",
          parts: [{ kind: "text", text: "Continue" }],
        }),
      ),
    ).rejects.toThrow(
      "Codex App Server requires a model selection with a reasoning effort variant.",
    );
  });

  test("updates the session model used for subsequent turns", async () => {
    const { adapter, transports } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    adapter.updateSessionModel({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread/start-runtime-live",
      model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
    });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        parts: [{ kind: "text", text: "Use deeper reasoning" }],
      }),
    );

    expect(transports.get("runtime-live")?.calls[3]).toEqual({
      method: "turn/start",
      params: {
        ...expectedTurnPolicy("/repo"),
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Use deeper reasoning" }],
        model: "gpt-5",
        effort: "high",
      },
    });
  });

  test("hydrates a saved session through the live runtime id", async () => {
    const { adapter, requireRepoRuntime, transports } = createHarness();

    await expect(
      adapter.loadSessionHistory({
        ...codexSessionRuntimeRef("thread-saved"),
      }),
    ).resolves.toEqual([
      expect.objectContaining({ messageId: "user-history-1", text: "Hello Codex" }),
      expect.objectContaining({ messageId: "reason-1" }),
      expect.objectContaining({ messageId: "cmd-read-1" }),
      expect.objectContaining({ messageId: "cmd-bash-1" }),
      expect.objectContaining({ messageId: "file-change-1" }),
      expect.objectContaining({ messageId: "file-change-failed-1" }),
      expect.objectContaining({ messageId: "dynamic-tool-1" }),
      expect.objectContaining({ messageId: "web-search-1" }),
      expect.objectContaining({ messageId: "tool-1" }),
      expect.objectContaining({ messageId: "tool-failed-1" }),
      expect.objectContaining({ messageId: "msg-1", text: "Hello from history" }),
      expect.objectContaining({ messageId: "msg-commentary-1", text: "Later commentary" }),
    ]);
    await expect(
      adapter.loadSessionDiff({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
      }),
    ).resolves.toEqual([
      {
        file: "src/app.ts",
        type: "modified",
        additions: 1,
        deletions: 0,
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n",
      },
    ]);

    expect(requireRepoRuntime).toHaveBeenCalledTimes(2);
    expect(transports.has("runtime-live")).toBe(true);
  });

  test("allows event subscription for a known session", async () => {
    const { adapter } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      () => {},
    );

    expect(typeof unsubscribe).toBe("function");
  });

  test("rejects event subscription for an existing session in another working directory", async () => {
    const { adapter } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    await expect(
      adapter.subscribeEvents(
        codexSessionRuntimeRef("thread/start-runtime-live", {
          workingDirectory: "/repo/worktrees/thread-start-runtime-live",
        }),
        () => {},
      ),
    ).rejects.toThrow("registered session belongs");
  });

  test("releases a Codex session by clearing only local adapter state", async () => {
    const { adapter, transports } = createHarness();

    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread-saved"),
      () => {},
    );
    await flushCodexAdapterWork();
    const transport = transports.get("runtime-live");
    const callsBeforeRelease = transport?.calls.length ?? 0;

    await adapter.releaseSession(codexSessionRef("thread-saved"));

    expect(localSessions(adapter).has("thread-saved")).toBe(false);
    expect(transport?.calls).toHaveLength(callsBeforeRelease);
    unsubscribe();
  });

  test("rejects release for an existing Codex session in another working directory", async () => {
    const { adapter } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    await expect(
      adapter.releaseSession({
        ...codexSessionRef("thread/start-runtime-live"),
        workingDirectory: "/repo/worktrees/thread-start-runtime-live",
      }),
    ).rejects.toThrow("registered session belongs");

    expect(localSessions(adapter).has("thread/start-runtime-live")).toBe(true);
  });

  test("rejects stop for an existing Codex session in another working directory", async () => {
    const { adapter } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    await expect(
      adapter.stopSession({
        ...codexSessionRef("thread/start-runtime-live"),
        workingDirectory: "/repo/worktrees/thread-start-runtime-live",
      }),
    ).rejects.toThrow("registered session belongs");

    expect(localSessions(adapter).has("thread/start-runtime-live")).toBe(true);
  });

  test("ignores release for unknown Codex sessions", async () => {
    const { adapter } = createHarness();

    await expect(
      adapter.releaseSession(codexSessionRef("missing-thread")),
    ).resolves.toBeUndefined();

    expect(localSessions(adapter).has("missing-thread")).toBe(false);
  });

  test("rejects missing or unsupported model variants", async () => {
    const missingVariant = createHarness();

    await expect(
      missingVariant.adapter.startSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        systemPrompt: "Use the repo rules.",
        model: { providerId: "openai", modelId: "gpt-5" },
      }),
    ).rejects.toThrow("requires a reasoning effort variant");

    const unsupportedVariant = createHarness();

    await expect(
      unsupportedVariant.adapter.startSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        systemPrompt: "Use the repo rules.",
        model: { providerId: "openai", modelId: "gpt-5", variant: "xhigh" },
      }),
    ).rejects.toThrow("does not support reasoning effort 'xhigh'");
  });

  test("fails clearly when a live runtime is missing", async () => {
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        requireRepoRuntime: async () => {
          throw new Error("No live repo runtime found for repo '/repo' and runtime 'codex'.");
        },
      },
      transportFactory: () => new RecordingTransport("runtime-live", false),
      onRuntimeEventQueueFailure: () => {},
      respondServerRequest: async () => {},
    });

    await expect(
      adapter.listAvailableModels({ repoPath: "/repo", runtimeKind: "codex" }),
    ).rejects.toThrow("No live repo runtime found for repo '/repo' and runtime 'codex'.");
  });

  test("starts a session in the requested build worktree through the repo runtime", async () => {
    const transport = new RecordingTransport("runtime-live", false);
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        requireRepoRuntime: async () => ({
          ...makeRuntimeSummary("runtime-live"),
          workingDirectory: "/repo",
        }),
      },
      transportFactory: () => transport,
      onRuntimeEventQueueFailure: () => {},
      subscribeEvents: () => () => {},
      respondServerRequest: async () => {},
    });

    await expect(
      adapter.startSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree-task-1",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        systemPrompt: "Use the repo rules.",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    ).resolves.toEqual(expect.objectContaining({ externalSessionId: "thread/start-runtime-live" }));

    expect(transport.calls[1]).toEqual({
      method: "thread/start",
      params: {
        ...expectedThreadPolicy,
        cwd: "/repo/worktree-task-1",
        developerInstructions: "Use the repo rules.",
        model: "gpt-5",
        effort: "medium",
      },
    });
    expect(transport.calls[2]).toEqual({
      method: "thread/name/set",
      params: {
        threadId: "thread/start-runtime-live",
        name: "BUILD task-1",
      },
    });
  });

  test("throws unsupported errors for unimplemented surfaces", () => {
    const { adapter } = createHarness();

    expect(() =>
      adapter.loadFileStatus({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
      }),
    ).toThrow("does not support loadFileStatus");
  });
});

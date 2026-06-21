import { describe, expect, test } from "bun:test";
import {
  codexSessionRef,
  codexSessionRuntimeRef,
  codexUserMessageInput,
  createAdapterWithTransport,
  createHarness,
  flushCodexAdapterWork,
  makeRuntimeSummary,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";
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

describe("CodexAppServerAdapter lifecycle", () => {
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
      taskId: "task-1",
      role: "build",
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
        taskId: "task-1",
        role: "build",
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
      taskId: "task-1",
      role: "spec",
      systemPrompt: "Use repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        role: "spec",
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
    const { adapter, transports, requireRepoRuntime } = createHarness();

    await adapter.resumeSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "planner",
      systemPrompt: "Carry forward the plan.",
      externalSessionId: "thread-9",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const forkSummary = await adapter.forkSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "qa",
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
      threadId: "thread-9",
      cwd: "/repo",
      developerInstructions: "Carry forward the plan.",
      model: "gpt-5",
      effort: "medium",
    });
    expect(transports.get("runtime-live")?.calls[2]?.params).toEqual({
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
  });

  test("sends user parts through turn/start on the live runtime id", async () => {
    const { adapter, transports } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "spec",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        role: "spec",
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
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Hello Codex" }],
        model: "gpt-5",
        effort: "medium",
      },
    });
  });

  test("updates the session model used for subsequent turns", async () => {
    const { adapter, transports } = createHarness();

    await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "spec",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    adapter.updateSessionModel({
      externalSessionId: "thread/start-runtime-live",
      model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
    });

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread/start-runtime-live",
        role: "spec",
        parts: [{ kind: "text", text: "Use deeper reasoning" }],
      }),
    );

    expect(transports.get("runtime-live")?.calls[3]).toEqual({
      method: "turn/start",
      params: {
        threadId: "thread/start-runtime-live",
        input: [{ type: "text", text: "Use deeper reasoning" }],
        model: "gpt-5",
        effort: "high",
      },
    });

    const history = await adapter.loadSessionHistory({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread/start-runtime-live",
    });
    const assistantMessage = history.find(
      (message) => message.role === "assistant" && message.messageId === "msg-1",
    );
    expect(assistantMessage?.model).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });
  });

  test("hydrates a saved session through the live runtime id", async () => {
    const { adapter, requireRepoRuntime, transports } = createHarness();

    await expect(
      adapter.loadSessionHistory({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-saved",
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
      taskId: "task-1",
      role: "build",
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    const unsubscribe = await adapter.subscribeEvents(
      codexSessionRuntimeRef("thread/start-runtime-live"),
      () => {},
    );

    expect(typeof unsubscribe).toBe("function");
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
        taskId: "task-1",
        role: "build",
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
        taskId: "task-1",
        role: "build",
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
      drainServerRequests: async () => [],
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
      drainServerRequests: async () => [],
      respondServerRequest: async () => {},
    });

    await expect(
      adapter.startSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree-task-1",
        taskId: "task-1",
        role: "build",
        systemPrompt: "Use the repo rules.",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    ).resolves.toEqual(expect.objectContaining({ externalSessionId: "thread/start-runtime-live" }));

    expect(transport.calls[1]).toEqual({
      method: "thread/start",
      params: {
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

import { describe, expect, mock, test } from "bun:test";
import { ODT_MCP_TOOL_NAMES, type AgentSessionControlStartInput } from "@openducktor/contracts";
import { AGENT_ROLE_TOOL_POLICY } from "@openducktor/core";
import {
  codexSessionRuntimeRef,
  codexUserMessageInput,
  codexLocalSessionsForTest,
  createAdapterWithTransport,
  createHarness,
  defaultCodexEffectivePolicy,
  flushCodexAdapterWork,
  makeRuntimeSummary,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";
import { CodexAppServerAdapter } from "./index";

class NameFailingTransport extends RecordingTransport {
  async request(request: Parameters<RecordingTransport["request"]>[0]) {
    if (request.method === "thread/name/set") {
      this.calls.push(request);
      throw new Error("name failed");
    }
    return super.request(request);
  }
}

class ResumeFailingTransport extends RecordingTransport {
  async request(request: Parameters<RecordingTransport["request"]>[0]) {
    if (request.method === "thread/resume") {
      this.calls.push(request);
      throw new Error("resume failed");
    }
    return super.request(request);
  }
}

const markSessionUnbound = (adapter: CodexAppServerAdapter, externalSessionId: string): void => {
  const session = codexLocalSessionsForTest(adapter).get(externalSessionId);
  if (!session) {
    throw new Error(`Expected retained session '${externalSessionId}'.`);
  }
  session.summary.sessionAssociation = { kind: "unbound" };
};

const expectedThreadPolicy = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandbox: "workspace-write",
};

const repositoryThreadConfig = {
  "mcp_servers.openducktor.enabled": true,
  "mcp_servers.openducktor.enabled_tools": [...ODT_MCP_TOOL_NAMES],
};

describe("CodexAppServerAdapter repository sessions", () => {
  test("rejects repository todo reads from retained workflow sessions", async () => {
    const { adapter, transports } = createHarness();
    const started = await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    const callCount = transports.get("runtime-live")?.calls.length;

    await expect(
      adapter.loadSessionTodos({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: started.externalSessionId,
        sessionScope: { kind: "repository" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      }),
    ).rejects.toThrow(
      "registered workflow scope for task 'task-1' and role 'build' does not match the requested repository scope",
    );
    expect(transports.get("runtime-live")?.calls).toHaveLength(callCount ?? 0);
  });

  test("applies repository policy across start, send, fork, resume, and history", async () => {
    const sessionScope = { kind: "repository" } as const;
    const runtimePolicy = { kind: "codex" as const, policy: defaultCodexEffectivePolicy() };
    const model = { providerId: "openai", modelId: "gpt-5", variant: "medium" } as const;
    const { adapter, transports } = createHarness();

    const started = await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope,
      runtimePolicy,
      systemPrompt: "Use the repo rules.",
      model,
    });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: started.externalSessionId,
        sessionScope,
        runtimePolicy,
        parts: [{ kind: "text", text: "Continue" }],
      }),
    );
    await adapter.loadSessionHistory(
      codexSessionRuntimeRef(started.externalSessionId, { sessionScope, runtimePolicy }),
    );
    const forked = await adapter.forkSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      parentExternalSessionId: started.externalSessionId,
      sessionScope,
      runtimePolicy,
      systemPrompt: "Use the repo rules.",
      model,
    });
    const resumed = await adapter.resumeSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread-resume",
      sessionScope,
      runtimePolicy,
      systemPrompt: "Use the repo rules.",
      model,
    });

    expect(started).toMatchObject({
      title: "Repository session",
      sessionAssociation: sessionScope,
      workingDirectory: "/repo",
    });
    expect(forked).toMatchObject({
      title: "Repository session",
      sessionAssociation: sessionScope,
    });
    expect(resumed).toMatchObject({
      title: "Repository session",
      sessionAssociation: sessionScope,
    });
    const calls = transports.get("runtime-live")?.calls ?? [];
    expect(calls.filter((call) => call.method === "thread/name/set")).toEqual([
      {
        method: "thread/name/set",
        params: { threadId: started.externalSessionId, name: "Repository session" },
      },
      {
        method: "thread/name/set",
        params: { threadId: forked.externalSessionId, name: "Repository session" },
      },
      {
        method: "thread/name/set",
        params: { threadId: resumed.externalSessionId, name: "Repository session" },
      },
    ]);
    for (const call of calls.filter((candidate) =>
      ["thread/start", "thread/fork", "thread/resume"].includes(candidate.method),
    )) {
      expect(call.params).toMatchObject({
        cwd: "/repo",
        ...expectedThreadPolicy,
        config: repositoryThreadConfig,
      });
    }
  });

  test("applies workflow policy before history binds a retained unbound session", async () => {
    const { adapter, transports } = createHarness();
    const started = await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    markSessionUnbound(adapter, started.externalSessionId);
    const transport = transports.get("runtime-live");
    expect(transport).toBeDefined();
    if (!transport) {
      throw new Error("Expected the runtime transport.");
    }
    transport.calls.length = 0;

    await adapter.loadSessionHistory(
      codexSessionRuntimeRef(started.externalSessionId, {
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );

    const resumeIndex = transport.calls.findIndex((call) => call.method === "thread/resume");
    const historyIndex = transport.calls.findIndex((call) => call.method === "thread/turns/list");
    expect(resumeIndex).toBeGreaterThanOrEqual(0);
    expect(historyIndex).toBeGreaterThan(resumeIndex);
    expect(transport.calls[resumeIndex]?.params).toEqual(
      expect.objectContaining({
        config: {
          "mcp_servers.openducktor.enabled": true,
          "mcp_servers.openducktor.enabled_tools": [...AGENT_ROLE_TOOL_POLICY.build],
        },
        threadId: started.externalSessionId,
        excludeTurns: true,
      }),
    );
  });

  test("applies workflow policy before sending from a retained unbound session", async () => {
    const { adapter, transports } = createHarness();
    const started = await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    markSessionUnbound(adapter, started.externalSessionId);
    const transport = transports.get("runtime-live");
    if (!transport) {
      throw new Error("Expected the runtime transport.");
    }
    transport.calls.length = 0;

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: started.externalSessionId,
        parts: [{ kind: "text", text: "Continue" }],
      }),
    );

    const resumeIndex = transport.calls.findIndex((call) => call.method === "thread/resume");
    const sendIndex = transport.calls.findIndex((call) => call.method === "turn/start");
    expect(resumeIndex).toBeGreaterThanOrEqual(0);
    expect(sendIndex).toBeGreaterThan(resumeIndex);
    expect(transport.calls[resumeIndex]?.params).toMatchObject({
      config: {
        "mcp_servers.openducktor.enabled": true,
        "mcp_servers.openducktor.enabled_tools": [...AGENT_ROLE_TOOL_POLICY.build],
      },
    });
  });

  test("applies workflow policy before context load binds a retained unbound session", async () => {
    const { adapter, transports } = createHarness();
    const started = await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    markSessionUnbound(adapter, started.externalSessionId);
    const transport = transports.get("runtime-live");
    if (!transport) {
      throw new Error("Expected the runtime transport.");
    }
    transport.calls.length = 0;

    await adapter.loadSessionContextUsage(codexSessionRuntimeRef(started.externalSessionId));

    expect(transport.calls.find((call) => call.method === "thread/resume")?.params).toMatchObject({
      config: {
        "mcp_servers.openducktor.enabled": true,
        "mcp_servers.openducktor.enabled_tools": [...AGENT_ROLE_TOOL_POLICY.build],
      },
    });
  });

  test("rejects stale history identity before changing a retained session", async () => {
    const { adapter, transports } = createHarness();
    const started = await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    const transport = transports.get("runtime-live");
    if (!transport) {
      throw new Error("Expected the runtime transport.");
    }
    transport.calls.length = 0;

    await expect(
      adapter.loadSessionHistory({
        ...codexSessionRuntimeRef(started.externalSessionId),
        workingDirectory: "/other",
      }),
    ).rejects.toThrow("registered session belongs to repo '/repo' and working directory '/repo'");
    expect(transport.calls).toEqual([]);
  });

  test("rejects a different workflow task or role for a bound session", async () => {
    const { adapter, transports } = createHarness();
    const started = await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    const callCount = transports.get("runtime-live")?.calls.length;

    await expect(
      adapter.resumeSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: started.externalSessionId,
        sessionScope: { kind: "workflow", taskId: "task-2", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        systemPrompt: "Use the repo rules.",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    ).rejects.toThrow("registered workflow scope for task 'task-1' and role 'spec'");

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: started.externalSessionId,
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          parts: [{ kind: "text", text: "Continue" }],
        }),
      ),
    ).rejects.toThrow("requested workflow scope for task 'task-1' and role 'build'");
    await expect(
      adapter.loadSessionHistory(
        codexSessionRuntimeRef(started.externalSessionId, {
          sessionScope: { kind: "workflow", taskId: "task-2", role: "spec" },
        }),
      ),
    ).rejects.toThrow("requested workflow scope for task 'task-2' and role 'spec'");
    await expect(
      adapter.loadSessionContextUsage(
        codexSessionRuntimeRef(started.externalSessionId, {
          sessionScope: { kind: "workflow", taskId: "task-1", role: "qa" },
        }),
      ),
    ).rejects.toThrow("requested workflow scope for task 'task-1' and role 'qa'");
    expect(transports.get("runtime-live")?.calls).toHaveLength(callCount ?? 0);
  });

  test("allows an explicit workflow role change only when forking", async () => {
    const { adapter, transports } = createHarness();
    const started = await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "spec" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    await expect(
      adapter.forkSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        parentExternalSessionId: started.externalSessionId,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        systemPrompt: "Use the repo rules.",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    ).resolves.toMatchObject({
      title: "BUILD task-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    });
    expect(
      transports.get("runtime-live")?.calls.findLast((call) => call.method === "thread/fork")
        ?.params,
    ).toMatchObject({
      config: {
        "mcp_servers.openducktor.enabled": true,
        "mcp_servers.openducktor.enabled_tools": [...AGENT_ROLE_TOOL_POLICY.build],
      },
    });
  });

  test("rejects a workflow scope for a repository-bound session", async () => {
    const { adapter, transports } = createHarness();
    const started = await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "repository" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    const callCount = transports.get("runtime-live")?.calls.length;

    await expect(
      adapter.resumeSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: started.externalSessionId,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        systemPrompt: "Use the repo rules.",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    ).rejects.toThrow("registered repository scope does not match the requested workflow scope");

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: started.externalSessionId,
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          parts: [{ kind: "text", text: "Continue" }],
        }),
      ),
    ).rejects.toThrow("registered repository scope does not match the requested workflow scope");
    expect(transports.get("runtime-live")?.calls).toHaveLength(callCount ?? 0);
  });

  test("rejects a start without session scope before runtime side effects", async () => {
    const { adapter, requireRepoRuntime, transportFactory } = createHarness();
    // SAFETY: This negative test deliberately omits sessionScope to exercise runtime validation at the adapter boundary.
    const input = {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    } as AgentSessionControlStartInput;

    await expect(adapter.startSession(input)).rejects.toThrow(
      "Cannot start Codex session without session context.",
    );
    expect(requireRepoRuntime).toHaveBeenCalledTimes(0);
    expect(transportFactory).toHaveBeenCalledTimes(0);
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

    expect(codexLocalSessionsForTest(adapter).has("thread/start-runtime-live")).toBe(true);
    expect(transport.calls.map((call) => call.method)).toEqual([
      "model/list",
      "thread/start",
      "thread/name/set",
    ]);
  });

  test("keeps resumed and history-restored repository sessions when thread naming fails", async () => {
    const repositoryScope = { kind: "repository" } as const;
    const resumedTransport = new NameFailingTransport("runtime-live", false);
    const resumedAdapter = createAdapterWithTransport(resumedTransport);

    await expect(
      resumedAdapter.resumeSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread-resume",
        sessionScope: repositoryScope,
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        systemPrompt: "Use the repo rules.",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    ).rejects.toThrow("name failed");
    expect(codexLocalSessionsForTest(resumedAdapter).has("thread-resume")).toBe(true);
    expect(resumedTransport.calls.find((call) => call.method === "thread/resume")?.params).toEqual(
      expect.objectContaining({ config: repositoryThreadConfig }),
    );

    const restoredTransport = new NameFailingTransport("runtime-live", false);
    const restoredAdapter = createAdapterWithTransport(restoredTransport);
    await expect(
      restoredAdapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread-history",
          sessionScope: repositoryScope,
          runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
          parts: [{ kind: "text", text: "Continue" }],
        }),
      ),
    ).rejects.toThrow("name failed");
    expect(codexLocalSessionsForTest(restoredAdapter).has("thread-history")).toBe(true);
    expect(restoredTransport.calls.find((call) => call.method === "thread/resume")?.params).toEqual(
      expect.objectContaining({ config: repositoryThreadConfig }),
    );
  });

  test("fails repository history restoration on a missing bound Codex route", async () => {
    const requireRepoRuntime = mock(async () => ({
      ...makeRuntimeSummary("runtime-wrong-route"),
      runtimeRoute: { type: "local_http" as const, endpoint: "http://127.0.0.1:43123" },
    }));
    const transportFactory = mock(() => {
      throw new Error("transportFactory should not be called");
    });
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: { requireRepoRuntime },
      transportFactory,
    });

    await expect(
      adapter.loadSessionHistory(
        codexSessionRuntimeRef("repository-history", {
          sessionScope: { kind: "repository" },
          runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
        }),
      ),
    ).rejects.toThrow(
      "runtime 'runtime-wrong-route' is missing required route contract 'stdio' for repo '/repo' while attempting to load Codex session history",
    );
    expect(requireRepoRuntime).toHaveBeenCalledTimes(1);
    expect(transportFactory).toHaveBeenCalledTimes(0);
  });

  test("keeps the retained model when resume fails", async () => {
    const sessionScope = { kind: "repository" } as const;
    const runtimePolicy = { kind: "codex" as const, policy: defaultCodexEffectivePolicy() };
    const transport = new ResumeFailingTransport("runtime-live", false);
    const adapter = createAdapterWithTransport(transport);
    const started = await adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope,
      runtimePolicy,
      systemPrompt: "original system prompt",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });

    await expect(
      adapter.resumeSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: started.externalSessionId,
        sessionScope,
        runtimePolicy,
        systemPrompt: "replacement system prompt",
        model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
      }),
    ).rejects.toThrow("resume failed");

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: started.externalSessionId,
        sessionScope,
        runtimePolicy,
        parts: [{ kind: "text", text: "Continue" }],
      }),
    );
    await flushCodexAdapterWork(adapter);

    expect(transport.calls.findLast((call) => call.method === "turn/start")?.params).toMatchObject({
      model: "gpt-5",
      effort: "medium",
    });
  });
});

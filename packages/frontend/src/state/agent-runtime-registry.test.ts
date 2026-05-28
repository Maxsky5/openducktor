import { describe, expect, mock, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { appQueryClient, clearAppQueryClient } from "@/lib/query-client";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  type ShellBridge,
} from "@/lib/shell-bridge";
import { createAgentRuntimeRegistry, DEFAULT_RUNTIME_KIND } from "./agent-runtime-registry";
import { host } from "./operations/shared/host";
import { agentSessionRuntimeQueryKeys } from "./queries/agent-session-runtime";
import { runtimeCatalogQueryKeys } from "./queries/runtime-catalog";

const createDeferred = <T>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolve?.(value);
    },
  };
};

const waitForSessionIdleEvent = async (
  events: Array<{ type?: string }>,
  deadline = Date.now() + 1_000,
): Promise<void> => {
  if (events.some((event) => event.type === "session_idle") || Date.now() >= deadline) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 10));
  await waitForSessionIdleEvent(events, deadline);
};

describe("agent-runtime-registry", () => {
  test("registers the shipped opencode and codex runtime adapters", () => {
    const registry = createAgentRuntimeRegistry();

    expect(registry.defaultRuntimeKind).toBe(DEFAULT_RUNTIME_KIND);
    expect(registry.registeredRuntimeKinds).toEqual(["opencode", "codex"]);
    expect(registry.getRuntimeDefinition("opencode").kind).toBe("opencode");
    expect(registry.getRuntimeDefinition("codex").kind).toBe("codex");
    expect(
      registry
        .createAgentEngine()
        .listRuntimeDefinitions()
        .map((runtime) => runtime.kind),
    ).toEqual(["opencode", "codex"]);
  });

  test("codex adapter resolves host-managed runtime ids through the host bridge", async () => {
    const originalRuntimeEnsure = host.runtimeEnsure;
    const originalRuntimeList = host.runtimeList;
    const originalCodexAppServerRequest = host.codexAppServerRequest;
    const runtimeEnsureCalls: unknown[][] = [];
    const runtimeListCalls: unknown[][] = [];
    const codexRequestCalls: unknown[][] = [];

    host.runtimeEnsure = mock(async (...args: unknown[]) => {
      runtimeEnsureCalls.push(args);
      return {
        kind: "codex",
        runtimeId: "runtime-codex-ensure",
        repoPath: "/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/repo",
        runtimeRoute: { type: "stdio" as const, identity: "runtime-codex-ensure" },
        startedAt: "2026-02-22T09:00:00.000Z",
        descriptor: CODEX_RUNTIME_DESCRIPTOR,
      };
    }) as typeof host.runtimeEnsure;
    host.runtimeList = mock(async (...args: unknown[]) => {
      runtimeListCalls.push(args);
      return [
        {
          kind: "codex",
          runtimeId: "runtime-codex-live",
          repoPath: "/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/repo",
          runtimeRoute: { type: "stdio" as const, identity: "runtime-codex-live" },
          startedAt: "2026-02-22T09:00:00.000Z",
          descriptor: CODEX_RUNTIME_DESCRIPTOR,
        },
      ];
    }) as typeof host.runtimeList;
    host.codexAppServerRequest = mock(async (...args: unknown[]) => {
      codexRequestCalls.push(args);
      const [, method] = args as [string, string, unknown?];
      if (method === "model/list") {
        return {
          data: [
            {
              id: "gpt-5",
              model: "gpt-5",
              displayName: "GPT-5",
              inputModalities: ["text", "image"],
              supportedReasoningEfforts: [
                { reasoningEffort: "medium", description: "Balanced reasoning" },
              ],
              isDefault: true,
            },
          ],
          nextCursor: null,
        };
      }
      return { thread: { id: "thread-codex" }, startedAt: "2026-02-22T09:00:00.000Z" };
    }) as typeof host.codexAppServerRequest;
    configureShellBridge({
      client: {} as HostClient,
      subscribeRunEvents: async () => () => {},
      subscribeDevServerEvents: async () => () => {},
      subscribeTaskEvents: async () => () => {},
      subscribeCodexAppServerEvents: async () => () => {},
      capabilities: {
        canOpenExternalUrls: true,
        canPreviewLocalAttachments: true,
      },
      openExternalUrl: async () => {},
      resolveLocalAttachmentPreviewSrc: async () => "asset://preview",
    } satisfies ShellBridge);

    try {
      const registry = createAgentRuntimeRegistry();

      await expect(
        registry.getAdapter("codex").startSession({
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo",
          taskId: "task-1",
          role: "build",
          systemPrompt: "Use the repo rules.",
          model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
        }),
      ).resolves.toMatchObject({ externalSessionId: "thread-codex" });

      await expect(
        registry.getAdapter("codex").listAvailableModels({
          repoPath: "/repo",
          runtimeKind: "codex",
        }),
      ).resolves.toMatchObject({ runtime: { kind: "codex" } });

      expect(runtimeEnsureCalls).toEqual([["/repo", "codex"]]);
      expect(runtimeListCalls).toEqual([["/repo", "codex"]]);
      expect(codexRequestCalls[0]?.[0]).toBe("runtime-codex-ensure");
      expect(codexRequestCalls[1]?.[0]).toBe("runtime-codex-ensure");
      expect(codexRequestCalls[2]?.[0]).toBe("runtime-codex-live");
    } finally {
      host.runtimeEnsure = originalRuntimeEnsure;
      host.runtimeList = originalRuntimeList;
      host.codexAppServerRequest = originalCodexAppServerRequest;
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("codex adapter receives live app-server events from the shell bridge", async () => {
    await clearAppQueryClient();
    const originalRuntimeList = host.runtimeList;
    const originalCodexAppServerRequest = host.codexAppServerRequest;
    const codexEventBridge: { listener?: (payload: unknown) => void } = {};

    host.runtimeList = mock(async () => [
      {
        kind: "codex",
        runtimeId: "runtime-codex-live",
        repoPath: "/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/repo",
        runtimeRoute: { type: "stdio" as const, identity: "runtime-codex-live" },
        startedAt: "2026-02-22T09:00:00.000Z",
        descriptor: CODEX_RUNTIME_DESCRIPTOR,
      },
    ]) as typeof host.runtimeList;
    host.codexAppServerRequest = mock(async (_runtimeId, method) => {
      if (method === "model/list") {
        return {
          data: [
            {
              id: "gpt-5",
              model: "gpt-5",
              displayName: "GPT-5",
              inputModalities: ["text", "image"],
              supportedReasoningEfforts: [
                { reasoningEffort: "medium", description: "Balanced reasoning" },
              ],
              isDefault: true,
            },
          ],
          nextCursor: null,
        };
      }
      if (method === "thread/resume") {
        return {
          thread: {
            id: "thread-live",
            cwd: "/repo",
            createdAt: 1_778_112_000,
            status: { type: "active", activeFlags: [] },
          },
          startedAt: "2026-02-22T09:00:00.000Z",
        };
      }
      throw new Error(`Unexpected Codex request '${method}'.`);
    }) as typeof host.codexAppServerRequest;
    configureShellBridge({
      client: {} as HostClient,
      subscribeRunEvents: async () => () => {},
      subscribeDevServerEvents: async () => () => {},
      subscribeTaskEvents: async () => () => {},
      subscribeCodexAppServerEvents: async (listener) => {
        codexEventBridge.listener = listener;
        return () => {
          delete codexEventBridge.listener;
        };
      },
      capabilities: {
        canOpenExternalUrls: true,
        canPreviewLocalAttachments: true,
      },
      openExternalUrl: async () => {},
      resolveLocalAttachmentPreviewSrc: async () => "asset://preview",
    } satisfies ShellBridge);

    try {
      const adapter = createAgentRuntimeRegistry().getAdapter("codex");
      await adapter.attachSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        taskId: "task-1",
        role: "build",
        systemPrompt: "Use the repo rules.",
        externalSessionId: "thread-live",
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      });

      const events: Array<{ type?: string }> = [];
      const unsubscribe = adapter.subscribeEvents("thread-live", (event) => events.push(event));
      const emitCodexEvent = codexEventBridge.listener;
      if (!emitCodexEvent) {
        throw new Error("Codex app-server event listener was not registered.");
      }
      const runtimeSkillKey = runtimeCatalogQueryKeys.repoSkills("/repo", "codex", "/repo");
      const sessionSkillKey = agentSessionRuntimeQueryKeys.skills("/repo", "codex", "/repo");
      appQueryClient.setQueryData(runtimeSkillKey, { skills: [] });
      appQueryClient.setQueryData(sessionSkillKey, { skills: [] });

      emitCodexEvent({
        runtimeId: "runtime-codex-live",
        kind: "notification",
        message: {
          method: "turn/completed",
          params: {
            threadId: "thread-live",
            turn: { id: "turn-live", status: "completed" },
          },
        },
      });

      await waitForSessionIdleEvent(events);
      expect(events.some((event) => event.type === "session_idle")).toBe(true);

      emitCodexEvent({
        runtimeId: "runtime-codex-live",
        kind: "notification",
        message: {
          method: "skills/changed",
          params: { cwd: "/repo" },
        },
      });

      expect(appQueryClient.getQueryState(runtimeSkillKey)?.isInvalidated).toBe(true);
      expect(appQueryClient.getQueryState(sessionSkillKey)?.isInvalidated).toBe(true);
      unsubscribe();
    } finally {
      host.runtimeList = originalRuntimeList;
      host.codexAppServerRequest = originalCodexAppServerRequest;
      await clearAppQueryClient();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("rejects unsupported runtime adapters", () => {
    const registry = createAgentRuntimeRegistry();

    expect(() => registry.getAdapter("test-runtime" as RuntimeKind)).toThrow(
      "Unsupported agent runtime 'test-runtime'.",
    );
  });

  test("requires an explicit runtime for adapter selection", async () => {
    const engine = createAgentRuntimeRegistry().createAgentEngine();

    const missingRuntimeInput = {
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "spec",
      systemPrompt: "Prompt",
    } as unknown as Parameters<typeof engine.startSession>[0];

    await expect(engine.startSession(missingRuntimeInput)).rejects.toThrow(
      "Runtime kind is required to select an agent runtime adapter.",
    );
  });

  test("requires live repo runtimes using the host runtimeList repo-kind argument order", async () => {
    const originalRuntimeList = host.runtimeList;
    const runtimeListCalls: unknown[] = [];
    host.runtimeList = mock(async (...args: unknown[]) => {
      runtimeListCalls.push(args);
      return [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          repoPath: "/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/repo",
          runtimeRoute: { type: "stdio" as const, identity: "runtime-stdio" },
          startedAt: "2026-02-22T09:00:00.000Z",
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        },
      ];
    }) as typeof host.runtimeList;

    try {
      await expect(
        createAgentRuntimeRegistry().getAdapter("opencode").listAvailableModels({
          runtimeKind: "opencode",
          repoPath: "/repo",
        }),
      ).rejects.toThrow("OpenCode runtime route 'stdio' is unsupported");

      expect(runtimeListCalls).toEqual([["/repo", "opencode"]]);
    } finally {
      host.runtimeList = originalRuntimeList;
    }
  });

  test("keeps runtime engine methods bound when passed as callbacks", async () => {
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalListAgentSessionPresenceSnapshots =
      OpencodeSdkAdapter.prototype.listSessionPresence;
    const listAvailableModels = mock(async () => ({
      models: [],
      defaultModelsByProvider: {},
    }));
    const loadSessionTodos = mock(async () => []);
    const listSessionPresence = mock(async () => []);

    try {
      OpencodeSdkAdapter.prototype.listAvailableModels = listAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = loadSessionTodos;
      OpencodeSdkAdapter.prototype.listSessionPresence = listSessionPresence;

      const engine = createAgentRuntimeRegistry().createAgentEngine();
      const {
        listAvailableModels: readModels,
        loadSessionTodos: readTodos,
        listSessionPresence: readPresences,
      } = engine;

      await readModels({
        runtimeKind: "opencode",
        repoPath: "/repo",
      });

      await readTodos({
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/tmp/repo",
        externalSessionId: "external-1",
      });

      await readPresences({
        runtimeKind: "opencode",
        repoPath: "/repo",
        directories: ["/tmp/repo"],
      });

      expect(listAvailableModels).toHaveBeenCalledTimes(1);
      expect(loadSessionTodos).toHaveBeenCalledTimes(1);
      expect(listSessionPresence).toHaveBeenCalledTimes(1);
    } finally {
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.listSessionPresence = originalListAgentSessionPresenceSnapshots;
    }
  });

  test("allows event subscription while attachSession is still registering the adapter session", async () => {
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const attachDeferred = createDeferred<void>();
    let attachStarted = false;
    const subscribedExternalSessionIds: string[] = [];

    OpencodeSdkAdapter.prototype.attachSession = async (input) => {
      attachStarted = true;
      await attachDeferred.promise;
      return {
        runtimeKind: input.runtimeKind,
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T09:00:00.000Z",
        role: input.role,
        status: "running",
      };
    };
    OpencodeSdkAdapter.prototype.subscribeEvents = (externalSessionId) => {
      subscribedExternalSessionIds.push(externalSessionId);
      return () => {};
    };

    const engine = createAgentRuntimeRegistry().createAgentEngine();

    try {
      const attachPromise = engine.attachSession({
        externalSessionId: "external-pending",
        repoPath: "/repo",
        workingDirectory: "/repo/worktree",
        taskId: "",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        role: "build",
        systemPrompt: "",
      });

      expect(attachStarted).toBe(true);
      expect(engine.hasSession("external-pending")).toBe(true);
      const unsubscribe = engine.subscribeEvents("external-pending", () => {});
      expect(subscribedExternalSessionIds).toEqual(["external-pending"]);

      attachDeferred.resolve();
      await attachPromise;
      unsubscribe();
    } finally {
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
    }
  });
});

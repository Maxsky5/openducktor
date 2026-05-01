import { describe, expect, mock, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeKind } from "@openducktor/contracts";
import { createAgentRuntimeRegistry, DEFAULT_RUNTIME_KIND } from "./agent-runtime-registry";
import { host } from "./operations/shared/host";

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

describe("agent-runtime-registry", () => {
  test("registers only the shipped opencode runtime adapter", () => {
    const registry = createAgentRuntimeRegistry();

    expect(registry.defaultRuntimeKind).toBe(DEFAULT_RUNTIME_KIND);
    expect(registry.registeredRuntimeKinds).toEqual(["opencode"]);
    expect(registry.getRuntimeDefinition("opencode").kind).toBe("opencode");
    expect(
      registry
        .createAgentEngine()
        .listRuntimeDefinitions()
        .map((runtime) => runtime.kind),
    ).toEqual(["opencode"]);
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
    const originalListLiveAgentSessionSnapshots =
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots;
    const listAvailableModels = mock(async () => ({
      models: [],
      defaultModelsByProvider: {},
    }));
    const loadSessionTodos = mock(async () => []);
    const listLiveAgentSessionSnapshots = mock(async () => []);

    try {
      OpencodeSdkAdapter.prototype.listAvailableModels = listAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = loadSessionTodos;
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = listLiveAgentSessionSnapshots;

      const engine = createAgentRuntimeRegistry().createAgentEngine();
      const {
        listAvailableModels: readModels,
        loadSessionTodos: readTodos,
        listLiveAgentSessionSnapshots: readSnapshots,
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

      await readSnapshots({
        runtimeKind: "opencode",
        repoPath: "/repo",
        directories: ["/tmp/repo"],
      });

      expect(listAvailableModels).toHaveBeenCalledTimes(1);
      expect(loadSessionTodos).toHaveBeenCalledTimes(1);
      expect(listLiveAgentSessionSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots =
        originalListLiveAgentSessionSnapshots;
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

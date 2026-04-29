import { describe, expect, mock, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { createAgentRuntimeRegistry, DEFAULT_RUNTIME_KIND } from "./agent-runtime-registry";

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

    expect(() => registry.getAdapter("test-runtime")).toThrow(
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
      scenario: "spec_initial",
      systemPrompt: "Prompt",
    } as unknown as Parameters<typeof engine.startSession>[0];

    await expect(engine.startSession(missingRuntimeInput)).rejects.toThrow(
      "Runtime kind is required to select an agent runtime adapter.",
    );
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

    OpencodeSdkAdapter.prototype.listAvailableModels = listAvailableModels;
    OpencodeSdkAdapter.prototype.loadSessionTodos = loadSessionTodos;
    OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = listLiveAgentSessionSnapshots;

    const engine = createAgentRuntimeRegistry().createAgentEngine();

    try {
      const {
        listAvailableModels: readModels,
        loadSessionTodos: readTodos,
        listLiveAgentSessionSnapshots: readSnapshots,
      } = engine;

      await readModels({
        runtimeKind: "opencode",
        runtimeConnection: {
          type: "local_http",
          endpoint: "http://127.0.0.1:1",
          workingDirectory: "/tmp/repo",
        },
      });

      await readTodos({
        runtimeKind: "opencode",
        runtimeConnection: {
          type: "local_http",
          endpoint: "http://127.0.0.1:1",
          workingDirectory: "/tmp/repo",
        },
        externalSessionId: "external-1",
      });

      await readSnapshots({
        runtimeKind: "opencode",
        runtimeConnection: {
          type: "local_http",
          endpoint: "http://127.0.0.1:1",
          workingDirectory: "/tmp/repo",
        },
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
});

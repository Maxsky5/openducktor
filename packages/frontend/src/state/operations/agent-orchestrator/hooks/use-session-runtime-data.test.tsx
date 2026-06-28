import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import { createElement, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import { useSessionRuntimeData } from "./use-session-runtime-data";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const cloneRuntimeDescriptor = (descriptor: RuntimeDescriptor): RuntimeDescriptor =>
  structuredClone(descriptor);

const createRuntimeDefinitions = ({ supportsTodos }: { supportsTodos: boolean }) => {
  const runtimeDefinition = cloneRuntimeDescriptor(OPENCODE_RUNTIME_DESCRIPTOR);
  runtimeDefinition.capabilities.optionalSurfaces.supportsTodos = supportsTodos;
  return [runtimeDefinition];
};

const emptyCatalog: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [],
  profiles: [],
  defaultModelsByProvider: {},
};

const todoFixture: AgentSessionTodoItem = {
  id: "todo-1",
  content: "Do it",
  status: "pending",
  priority: "high",
};

const sessionIdentity = (overrides: Partial<AgentSessionIdentity> = {}): AgentSessionIdentity => ({
  externalSessionId: "external-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
  ...overrides,
});

const sessionState = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => {
  const identity = sessionIdentity(overrides);
  return {
    ...identity,
    taskId: "task-1",
    role: "build",
    status: "idle",
    startedAt: "2026-06-12T08:00:00.000Z",
    historyLoadState: "loaded",
    messages: createSessionMessagesState(identity.externalSessionId),
    contextUsage: null,
    pendingApprovals: [],
    pendingQuestions: [],
    selectedModel: null,
    ...overrides,
  };
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(QueryProvider, { useIsolatedClient: true }, children);

describe("useSessionRuntimeData", () => {
  test("returns empty runtime data without a selected session", async () => {
    const loadRuntimeCatalog = mock(async () => {
      throw new Error("model catalog should not be queried");
    });
    const readSessionTodos = mock(async () => {
      throw new Error("todos should not be queried");
    });
    const harness = createHookHarness(
      useSessionRuntimeData,
      {
        repoPath: "/repo",
        selectedSessionIdentity: null,
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
        repoReadinessState: "ready",
        loadRuntimeCatalog,
        readSessionTodos,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(loadRuntimeCatalog).not.toHaveBeenCalled();
      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(harness.getLatest()).toEqual({
        modelCatalog: null,
        todos: [],
        isLoadingModelCatalog: false,
        error: null,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not query session todos when the runtime does not support todos", async () => {
    const loadRuntimeCatalog = mock(() => new Promise<AgentModelCatalog>(() => {}));
    const readSessionTodos = mock(async () => {
      throw new Error("todos should not be queried");
    });
    const harness = createHookHarness(
      useSessionRuntimeData,
      {
        repoPath: "/repo",
        selectedSessionIdentity: sessionState(),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: false }),
        repoReadinessState: "ready",
        loadRuntimeCatalog,
        readSessionTodos,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(harness.getLatest().todos).toEqual([]);
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("waits for repo runtime readiness before reading session runtime data", async () => {
    const loadRuntimeCatalog = mock(async () => {
      throw new Error("model catalog should not be queried");
    });
    const readSessionTodos = mock(async () => {
      throw new Error("todos should not be queried");
    });
    const harness = createHookHarness(
      useSessionRuntimeData,
      {
        repoPath: "/repo",
        selectedSessionIdentity: sessionState(),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
        repoReadinessState: "checking",
        loadRuntimeCatalog,
        readSessionTodos,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(loadRuntimeCatalog).not.toHaveBeenCalled();
      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(harness.getLatest()).toEqual({
        modelCatalog: null,
        todos: [],
        isLoadingModelCatalog: false,
        error: null,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps cached selected-session runtime data while runtime readiness drops", async () => {
    const loadRuntimeCatalog = mock(async () => emptyCatalog);
    const readSessionTodos = mock(async () => [todoFixture]);
    const readyProps: Parameters<typeof useSessionRuntimeData>[0] = {
      repoPath: "/repo",
      selectedSessionIdentity: sessionState(),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      repoReadinessState: "ready",
      loadRuntimeCatalog,
      readSessionTodos,
    };
    const harness = createHookHarness(useSessionRuntimeData, readyProps, { wrapper });

    try {
      await harness.mount();
      await harness.waitFor((latest) => latest.todos.length === 1);
      expect(harness.getLatest().todos).toEqual([todoFixture]);

      await harness.update({
        ...readyProps,
        repoReadinessState: "checking",
      });

      expect(loadRuntimeCatalog).toHaveBeenCalledTimes(1);
      expect(readSessionTodos).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().modelCatalog).toEqual(emptyCatalog);
      expect(harness.getLatest().todos).toEqual([todoFixture]);
      expect(harness.getLatest().isLoadingModelCatalog).toBe(false);
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("reads todos from selected-session identity without waiting for hydrated history", async () => {
    const loadRuntimeCatalog = mock(async () => emptyCatalog);
    const readSessionTodos = mock(async () => [todoFixture]);
    const harness = createHookHarness(
      useSessionRuntimeData,
      {
        repoPath: "/repo",
        selectedSessionIdentity: sessionState(),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
        repoReadinessState: "ready" as const,
        loadRuntimeCatalog,
        readSessionTodos,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((latest) => latest.todos.length === 1);

      expect(readSessionTodos).toHaveBeenCalledTimes(1);
      expect(readSessionTodos).toHaveBeenCalledWith({
        externalSessionId: "external-1",
        repoPath: "/repo",
        runtimeKind: "opencode",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimePolicy: { kind: "opencode" },
        workingDirectory: "/repo",
      });
      expect(harness.getLatest().todos).toEqual([todoFixture]);
    } finally {
      await harness.unmount();
    }
  });

  test("reads todos whenever selected-session runtime data is supported and ready", async () => {
    const loadRuntimeCatalog = mock(async () => emptyCatalog);
    const readSessionTodos = mock(async () => [todoFixture]);
    const harness = createHookHarness(
      useSessionRuntimeData,
      {
        repoPath: "/repo",
        selectedSessionIdentity: sessionState(),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
        repoReadinessState: "ready",
        loadRuntimeCatalog,
        readSessionTodos,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((latest) => latest.modelCatalog !== null && latest.todos.length === 1);

      expect(loadRuntimeCatalog).toHaveBeenCalledTimes(1);
      expect(readSessionTodos).toHaveBeenCalledTimes(1);
      expect(harness.getLatest()).toEqual({
        modelCatalog: emptyCatalog,
        todos: [todoFixture],
        isLoadingModelCatalog: false,
        error: null,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps runtime data stable when the selected session identity object is rebuilt", async () => {
    const loadRuntimeCatalog = mock(async () => emptyCatalog);
    const readSessionTodos = mock(async () => [todoFixture]);
    const props: Parameters<typeof useSessionRuntimeData>[0] = {
      repoPath: "/repo",
      selectedSessionIdentity: sessionState(),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      repoReadinessState: "ready",
      loadRuntimeCatalog,
      readSessionTodos,
    };
    const harness = createHookHarness(useSessionRuntimeData, props, { wrapper });

    try {
      await harness.mount();
      await harness.waitFor((latest) => latest.modelCatalog !== null && latest.todos.length === 1);
      const runtimeData = harness.getLatest();

      await harness.update({
        ...props,
        selectedSessionIdentity: sessionState(),
      });

      expect(loadRuntimeCatalog).toHaveBeenCalledTimes(1);
      expect(readSessionTodos).toHaveBeenCalledTimes(1);
      expect(harness.getLatest()).toBe(runtimeData);
    } finally {
      await harness.unmount();
    }
  });

  test("reports missing workspace repo path without querying runtime data", async () => {
    const loadRuntimeCatalog = mock(async () => emptyCatalog);
    const readSessionTodos = mock(async () => [todoFixture]);
    const harness = createHookHarness(
      useSessionRuntimeData,
      {
        repoPath: null,
        selectedSessionIdentity: sessionIdentity(),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
        repoReadinessState: "ready",
        loadRuntimeCatalog,
        readSessionTodos,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(loadRuntimeCatalog).not.toHaveBeenCalled();
      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(harness.getLatest().error).toBe(
        "Repository path is required to read selected session runtime data.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("fails fast on invalid selected session runtime context", async () => {
    const loadRuntimeCatalog = mock(async () => emptyCatalog);
    const readSessionTodos = mock(async () => [todoFixture]);
    const harness = createHookHarness(
      useSessionRuntimeData,
      {
        repoPath: "/repo",
        selectedSessionIdentity: sessionState({ workingDirectory: "" }),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
        repoReadinessState: "ready",
        loadRuntimeCatalog,
        readSessionTodos,
      },
      { wrapper },
    );

    await expect(harness.mount()).rejects.toThrow(
      "Session workingDirectory is required to reach session 'external-1'.",
    );
    expect(loadRuntimeCatalog).toHaveBeenCalledTimes(1);
    expect(readSessionTodos).not.toHaveBeenCalled();
  });
});

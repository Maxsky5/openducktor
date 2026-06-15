import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import { createElement, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
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

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(QueryProvider, { useIsolatedClient: true }, children);

describe("useSessionRuntimeData", () => {
  test("does not query session todos when the runtime does not support todos", async () => {
    const readSessionModelCatalog = mock(() => new Promise<AgentModelCatalog>(() => {}));
    const readSessionTodos = mock(async () => {
      throw new Error("todos should not be queried");
    });
    const harness = createHookHarness(
      useSessionRuntimeData,
      {
        repoPath: "/repo",
        session: createAgentSessionFixture({
          externalSessionId: "external-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo",
        }),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: false }),
        repoReadinessState: "ready",
        readSessionModelCatalog,
        readSessionTodos,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(harness.getLatest().runtimeData.todos).toEqual([]);
      expect(harness.getLatest().runtimeDataError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("waits for repo runtime readiness before reading session runtime data", async () => {
    const readSessionModelCatalog = mock(async () => {
      throw new Error("model catalog should not be queried");
    });
    const readSessionTodos = mock(async () => {
      throw new Error("todos should not be queried");
    });
    const harness = createHookHarness(
      useSessionRuntimeData,
      {
        repoPath: "/repo",
        session: createAgentSessionFixture({
          externalSessionId: "external-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo",
        }),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
        repoReadinessState: "checking",
        readSessionModelCatalog,
        readSessionTodos,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(readSessionModelCatalog).not.toHaveBeenCalled();
      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(harness.getLatest().runtimeData).toEqual({
        modelCatalog: null,
        todos: [],
        isLoadingModelCatalog: false,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("reads todos only after selected session history is loaded", async () => {
    const readSessionModelCatalog = mock(async () => emptyCatalog);
    const readSessionTodos = mock(async () => [todoFixture]);
    const loadingSession = createAgentSessionFixture({
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      historyLoadState: "loading",
    });
    const loadedSession = {
      ...loadingSession,
      historyLoadState: "loaded" as const,
    };
    const baseArgs = {
      repoPath: "/repo",
      session: loadingSession,
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      repoReadinessState: "ready" as const,
      readSessionModelCatalog,
      readSessionTodos,
    };
    const harness = createHookHarness(useSessionRuntimeData, baseArgs, { wrapper });

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionModelCatalog.mock.calls.length > 0);

      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(harness.getLatest().runtimeData.todos).toEqual([]);

      await harness.update({
        ...baseArgs,
        session: loadedSession,
      });
      await harness.waitFor((latest) => latest.runtimeData.todos.length === 1);

      expect(readSessionTodos).toHaveBeenCalledTimes(1);
      expect(readSessionTodos).toHaveBeenCalledWith({
        externalSessionId: "external-1",
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
      });
      expect(harness.getLatest().runtimeData.todos).toEqual([todoFixture]);
    } finally {
      await harness.unmount();
    }
  });

  test("reports invalid selected session runtime context without querying runtime data", async () => {
    const readSessionModelCatalog = mock(async () => emptyCatalog);
    const readSessionTodos = mock(async () => [todoFixture]);
    const harness = createHookHarness(
      useSessionRuntimeData,
      {
        repoPath: "/repo",
        session: createAgentSessionFixture({
          externalSessionId: "external-1",
          runtimeKind: "opencode",
          workingDirectory: "",
        }),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
        repoReadinessState: "ready",
        readSessionModelCatalog,
        readSessionTodos,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(readSessionModelCatalog).not.toHaveBeenCalled();
      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(harness.getLatest().runtimeDataError).toBe(
        "Session workingDirectory is required to read active session runtime data.",
      );
    } finally {
      await harness.unmount();
    }
  });
});

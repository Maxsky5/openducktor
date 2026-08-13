import { describe, expect, mock, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { host } from "@/state/operations/shared/host";
import { runtimeCatalogQueryKeys } from "@/state/queries/runtime-catalog";
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
    runtimeStatusMessage: null,
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

const identityTarget = (identity = sessionIdentity()) => ({
  identity,
  taskBinding: null,
  liveSessionAssociation: null,
  selectedModel: null,
});

const sessionTarget = (state = sessionState()) => ({
  identity: sessionIdentity(state),
  taskBinding: state.role ? { taskId: state.taskId, role: state.role } : null,
  liveSessionAssociation: null,
  selectedModel: state.selectedModel,
});

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
        selectedSession: null,
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
        catalogError: null,
        todosError: null,
        runtimePolicyError: null,
        contextError: null,
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
        selectedSession: sessionTarget(),
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
      expect(harness.getLatest()).toEqual(
        expect.objectContaining({
          catalogError: null,
          todosError: null,
          runtimePolicyError: null,
          contextError: null,
        }),
      );
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
        selectedSession: sessionTarget(),
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
        catalogError: null,
        todosError: null,
        runtimePolicyError: null,
        contextError: null,
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
      selectedSession: sessionTarget(),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      repoReadinessState: "ready",
      loadRuntimeCatalog,
      readSessionTodos,
    };
    const harness = createHookHarness(useSessionRuntimeData, readyProps, { wrapper });

    try {
      await harness.mount();
      await harness.waitFor((latest) => latest.todos.length === 1, 1_000);
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
      expect(harness.getLatest()).toEqual(
        expect.objectContaining({
          catalogError: null,
          todosError: null,
          runtimePolicyError: null,
          contextError: null,
        }),
      );
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
        selectedSession: sessionTarget(),
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
        runtimePolicy: { kind: "opencode" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
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
        selectedSession: sessionTarget(),
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
        catalogError: null,
        todosError: null,
        runtimePolicyError: null,
        contextError: null,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("marks a retained selected-session catalog as loading during a background refresh", async () => {
    let resolveSuccessfulRefresh: ((catalog: AgentModelCatalog) => void) | undefined;
    const successfulRefresh = new Promise<AgentModelCatalog>((resolve) => {
      resolveSuccessfulRefresh = resolve;
    });
    const refreshedCatalog: AgentModelCatalog = {
      ...emptyCatalog,
      models: [
        {
          id: "openai/gpt-5",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5",
          modelName: "GPT 5",
          variants: [],
        },
      ],
    };
    const catalogRequests = [Promise.resolve(emptyCatalog), successfulRefresh];
    const loadRuntimeCatalog = mock(() => {
      const request = catalogRequests.shift();
      if (!request) {
        throw new Error("unexpected model catalog request");
      }
      return request;
    });
    const readSessionTodos = mock(async () => []);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const isolatedWrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
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
      { wrapper: isolatedWrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((latest) => latest.modelCatalog === emptyCatalog);

      await harness.run(() => {
        void queryClient.invalidateQueries({
          queryKey: runtimeCatalogQueryKeys.repo("/repo", "opencode"),
          exact: true,
        });
      });
      await harness.waitFor(() => loadRuntimeCatalog.mock.calls.length === 2);
      expect(
        queryClient.isFetching({
          queryKey: runtimeCatalogQueryKeys.repo("/repo", "opencode"),
          exact: true,
        }),
      ).toBe(1);
      await harness.waitFor((latest) => latest.isLoadingModelCatalog);
      expect(harness.getLatest()).toEqual(
        expect.objectContaining({
          modelCatalog: emptyCatalog,
          isLoadingModelCatalog: true,
          catalogError: null,
        }),
      );

      resolveSuccessfulRefresh?.(refreshedCatalog);
      await harness.waitFor(
        (latest) =>
          latest.modelCatalog?.models[0]?.modelId === "gpt-5" && !latest.isLoadingModelCatalog,
      );
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("reports a failed selected-session background refresh after loading ends", async () => {
    let rejectRefresh: ((reason: Error) => void) | undefined;
    const failedRefresh = new Promise<AgentModelCatalog>((_resolve, reject) => {
      rejectRefresh = reject;
    });
    const catalogRequests = [Promise.resolve(emptyCatalog), failedRefresh];
    const loadRuntimeCatalog = mock(() => {
      const request = catalogRequests.shift();
      if (!request) {
        throw new Error("unexpected model catalog request");
      }
      return request;
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const isolatedWrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const harness = createHookHarness(
      useSessionRuntimeData,
      {
        repoPath: "/repo",
        selectedSessionIdentity: sessionState(),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: false }),
        repoReadinessState: "ready",
        loadRuntimeCatalog,
        readSessionTodos: mock(async () => []),
      },
      { wrapper: isolatedWrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((latest) => latest.modelCatalog === emptyCatalog);
      await harness.run(() => {
        void queryClient.invalidateQueries({
          queryKey: runtimeCatalogQueryKeys.repo("/repo", "opencode"),
          exact: true,
        });
      });
      await harness.waitFor((latest) => latest.isLoadingModelCatalog);
      expect(harness.getLatest().catalogError).toBeNull();

      rejectRefresh?.(new Error("Catalog refresh failed"));
      await harness.waitFor((latest) => latest.catalogError === "Catalog refresh failed");
      expect(harness.getLatest()).toEqual(
        expect.objectContaining({
          modelCatalog: emptyCatalog,
          isLoadingModelCatalog: false,
          catalogError: "Catalog refresh failed",
        }),
      );
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("keeps a valid model catalog when the session todos read fails", async () => {
    const loadRuntimeCatalog = mock(async () => emptyCatalog);
    const readSessionTodos = mock(async () => {
      throw new Error("Session todos unavailable");
    });
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
      await harness.waitFor(
        (latest) => latest.modelCatalog !== null && latest.todosError !== null,
        2000,
      );

      expect(harness.getLatest()).toEqual(
        expect.objectContaining({
          modelCatalog: emptyCatalog,
          catalogError: null,
          todosError: "Session todos unavailable",
          runtimePolicyError: null,
          contextError: null,
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("keeps a valid Codex model catalog when runtime policy settings fail", async () => {
    const original = host.workspaceGetSettingsSnapshot;
    host.workspaceGetSettingsSnapshot = mock(async () => {
      throw new Error("Runtime policy settings unavailable");
    });
    const codexCatalog: AgentModelCatalog = {
      ...emptyCatalog,
      runtime: CODEX_RUNTIME_DESCRIPTOR,
    };
    const loadRuntimeCatalog = mock(async () => codexCatalog);
    const readSessionTodos = mock(async () => []);
    const harness = createHookHarness(
      useSessionRuntimeData,
      {
        repoPath: "/repo",
        selectedSessionIdentity: sessionState({ runtimeKind: "codex" }),
        runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR],
        repoReadinessState: "ready",
        loadRuntimeCatalog,
        readSessionTodos,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(
        (latest) => latest.modelCatalog !== null && latest.runtimePolicyError !== null,
        2000,
      );

      expect(harness.getLatest()).toEqual(
        expect.objectContaining({
          modelCatalog: codexCatalog,
          catalogError: null,
          todosError: null,
          runtimePolicyError: "Runtime policy settings unavailable",
          contextError: null,
        }),
      );
    } finally {
      await harness.unmount();
      host.workspaceGetSettingsSnapshot = original;
    }
  });

  test("keeps runtime data stable when the selected session identity object is rebuilt", async () => {
    const loadRuntimeCatalog = mock(async () => emptyCatalog);
    const readSessionTodos = mock(async () => [todoFixture]);
    const props: Parameters<typeof useSessionRuntimeData>[0] = {
      repoPath: "/repo",
      selectedSession: sessionTarget(),
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
        selectedSession: sessionTarget(),
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
        selectedSession: identityTarget(),
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
      expect(harness.getLatest().contextError).toBe(
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
        selectedSession: sessionTarget(sessionState({ workingDirectory: "" })),
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
    expect(loadRuntimeCatalog).not.toHaveBeenCalled();
    expect(readSessionTodos).not.toHaveBeenCalled();
  });
});

import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createLoadSessionModelCatalog, createLoadSessionTodos } from "./session-loaders";

const createDeferred = <T>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
};

const catalogFixture: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["high", "low"],
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  profiles: [],
};

const createSession = (
  overrides: Partial<AgentSessionState> = {},
  todos: AgentSessionTodoItem[] = [],
): AgentSessionState => ({
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: overrides.repoPath ?? "/tmp/repo",
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt: "2026-03-01T09:00:00.000Z",
  runtimeId: "runtime-1",
  workingDirectory: "/tmp/repo",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos,
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
});

const createStateHarness = (session: AgentSessionState) => {
  let state: Record<string, AgentSessionState> = {
    [session.externalSessionId]: session,
  };
  const updateSession = (
    externalSessionId: string,
    updater: (current: AgentSessionState) => AgentSessionState,
  ): void => {
    const current = state[externalSessionId];
    if (!current) {
      return;
    }
    const next = updater(current);
    state = {
      ...state,
      [externalSessionId]: next,
    };
  };
  return {
    getState: () => state,
    updateSession,
  };
};

const repoPath = "/tmp/repo";
const workingDirectory = "/tmp/repo/worktree";

describe("agent-orchestrator/lifecycle/session-loaders", () => {
  test("loads model catalog and clears loading state", async () => {
    const deferredCatalog = createDeferred<AgentModelCatalog>();
    const harness = createStateHarness(createSession());
    const modelCatalogInputs: Array<{ repoPath: string; runtimeKind: string }> = [];
    const loadSessionModelCatalog = createLoadSessionModelCatalog({
      adapter: {
        listAvailableModels: async (input) => {
          modelCatalogInputs.push(input);
          return deferredCatalog.promise;
        },
        loadSessionTodos: async () => [],
      },
      updateSession: harness.updateSession,
    });

    const loadPromise = loadSessionModelCatalog(
      "external-1",
      repoPath,
      "opencode",
      workingDirectory,
    );

    expect(harness.getState()["external-1"]?.isLoadingModelCatalog).toBe(true);

    deferredCatalog.resolve(catalogFixture);
    await loadPromise;

    const session = harness.getState()["external-1"];
    expect(session?.isLoadingModelCatalog).toBe(false);
    expect(session?.modelCatalog).toEqual(catalogFixture);
    expect(modelCatalogInputs).toEqual([{ repoPath, runtimeKind: "opencode" }]);
    expect(session?.selectedModel).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });
  });

  test("rejects model catalog errors after clearing loading state", async () => {
    const harness = createStateHarness(createSession());
    const loadSessionModelCatalog = createLoadSessionModelCatalog({
      adapter: {
        listAvailableModels: async () => {
          throw new Error("catalog failed");
        },
        loadSessionTodos: async () => [],
      },
      updateSession: harness.updateSession,
    });

    await expect(
      loadSessionModelCatalog("external-1", repoPath, "opencode", workingDirectory),
    ).rejects.toThrow("catalog failed");

    const session = harness.getState()["external-1"];
    expect(session?.isLoadingModelCatalog).toBe(false);
    expect(session ? getSessionMessageCount(session) : null).toBe(0);
  });

  test("dedupes in-flight model catalog loads for the same repo-scoped runtime", async () => {
    const deferredCatalog = createDeferred<AgentModelCatalog>();
    const harness = createStateHarness(createSession());
    let catalogLoads = 0;
    const loadSessionModelCatalog = createLoadSessionModelCatalog({
      adapter: {
        listAvailableModels: async () => {
          catalogLoads += 1;
          return deferredCatalog.promise;
        },
        loadSessionTodos: async () => [],
      },
      updateSession: harness.updateSession,
    });

    const firstLoad = loadSessionModelCatalog("external-1", repoPath, "opencode", workingDirectory);
    const secondLoad = loadSessionModelCatalog(
      "external-1",
      repoPath,
      "opencode",
      workingDirectory,
    );

    deferredCatalog.resolve(catalogFixture);
    await Promise.all([firstLoad, secondLoad]);

    expect(catalogLoads).toBe(1);
    expect(harness.getState()["external-1"]?.modelCatalog).toEqual(catalogFixture);
  });

  test("rejects empty working directory before adapter call", async () => {
    const harness = createStateHarness(createSession());
    let listAvailableModelsCalled = false;
    const loadSessionModelCatalog = createLoadSessionModelCatalog({
      adapter: {
        listAvailableModels: async () => {
          listAvailableModelsCalled = true;
          return catalogFixture;
        },
        loadSessionTodos: async () => [],
      },
      updateSession: harness.updateSession,
    });

    await expect(
      loadSessionModelCatalog("external-1", repoPath, "opencode", "   "),
    ).rejects.toThrow("Session runtime workingDirectory is required.");

    const session = harness.getState()["external-1"];
    expect(listAvailableModelsCalled).toBe(false);
    expect(session?.isLoadingModelCatalog).toBe(false);
    expect(session ? getSessionMessageCount(session) : null).toBe(0);
  });

  test("passes repo-scoped model catalog inputs to the adapter", async () => {
    const harness = createStateHarness(createSession());
    let receivedRepoPath: string | null = null;
    let receivedRuntimeKind: string | null = null;
    const loadSessionModelCatalog = createLoadSessionModelCatalog({
      adapter: {
        listAvailableModels: async ({ repoPath: adapterRepoPath, runtimeKind }) => {
          receivedRepoPath = adapterRepoPath;
          receivedRuntimeKind = runtimeKind;
          return catalogFixture;
        },
        loadSessionTodos: async () => [],
      },
      updateSession: harness.updateSession,
    });

    await loadSessionModelCatalog("external-1", repoPath, "opencode", workingDirectory);

    if (receivedRepoPath === null || receivedRuntimeKind === null) {
      throw new Error("Expected the model catalog adapter to receive repo-scoped runtime inputs.");
    }
    expect(receivedRepoPath as string).toBe(repoPath);
    expect(receivedRuntimeKind as string).toBe("opencode");
    expect(harness.getState()["external-1"]?.modelCatalog).toEqual(catalogFixture);
  });

  test("loads todos and merges while preserving existing order", async () => {
    const harness = createStateHarness(
      createSession({}, [
        { id: "a", content: "A", status: "pending", priority: "medium" },
        { id: "b", content: "B", status: "pending", priority: "medium" },
      ]),
    );
    const loadSessionTodosInputs: Array<{
      repoPath: string;
      runtimeKind: string;
      workingDirectory: string;
      externalSessionId: string;
    }> = [];
    const loadSessionTodos = createLoadSessionTodos({
      adapter: {
        listAvailableModels: async () => catalogFixture,
        loadSessionTodos: async (input) => {
          loadSessionTodosInputs.push(input);
          return [
            { id: "b", content: "B updated", status: "in_progress", priority: "high" },
            { id: "c", content: "C", status: "pending", priority: "low" },
            { id: "a", content: "A updated", status: "completed", priority: "medium" },
          ];
        },
      },
      supportsSessionTodos: () => true,
      updateSession: harness.updateSession,
    });

    await loadSessionTodos("external-1", repoPath, "opencode", workingDirectory);

    expect(loadSessionTodosInputs).toEqual([
      {
        repoPath,
        runtimeKind: "opencode",
        workingDirectory,
        externalSessionId: "external-1",
      },
    ]);

    const mergedTodos = harness.getState()["external-1"]?.todos ?? [];
    expect(mergedTodos.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(mergedTodos[0]?.content).toBe("A updated");
    expect(mergedTodos[1]?.status).toBe("in_progress");
  });

  test("throws for invalid todo working directory before adapter call", async () => {
    const harness = createStateHarness(createSession());
    let loadSessionTodosCalled = false;
    const loadSessionTodos = createLoadSessionTodos({
      adapter: {
        listAvailableModels: async () => catalogFixture,
        loadSessionTodos: async () => {
          loadSessionTodosCalled = true;
          return [];
        },
      },
      supportsSessionTodos: () => true,
      updateSession: harness.updateSession,
    });

    await expect(
      loadSessionTodos("external-1", repoPath, "opencode", "/tmp/repo/../escape"),
    ).rejects.toThrow("Session runtime workingDirectory must not contain traversal segments.");
    expect(loadSessionTodosCalled).toBe(false);
  });

  test("dedupes in-flight todo loads for the same session runtime identity", async () => {
    const deferredTodos = createDeferred<AgentSessionTodoItem[]>();
    const harness = createStateHarness(createSession());
    let todoLoads = 0;
    const loadSessionTodos = createLoadSessionTodos({
      adapter: {
        listAvailableModels: async () => catalogFixture,
        loadSessionTodos: async () => {
          todoLoads += 1;
          return deferredTodos.promise;
        },
      },
      supportsSessionTodos: () => true,
      updateSession: harness.updateSession,
    });

    const firstLoad = loadSessionTodos("external-1", repoPath, "opencode", workingDirectory);
    const secondLoad = loadSessionTodos("external-1", repoPath, "opencode", workingDirectory);

    deferredTodos.resolve([
      { id: "todo-1", content: "Todo", status: "pending", priority: "medium" },
    ]);
    await Promise.all([firstLoad, secondLoad]);

    expect(todoLoads).toBe(1);
    expect(harness.getState()["external-1"]?.todos).toEqual([
      { id: "todo-1", content: "Todo", status: "pending", priority: "medium" },
    ]);
  });

  test("skips adapter todos loading when runtime does not support todos", async () => {
    const harness = createStateHarness(
      createSession({}, [{ id: "a", content: "A", status: "pending", priority: "medium" }]),
    );
    let loadSessionTodosCalled = false;
    const loadSessionTodos = createLoadSessionTodos({
      adapter: {
        listAvailableModels: async () => catalogFixture,
        loadSessionTodos: async () => {
          loadSessionTodosCalled = true;
          return [];
        },
      },
      supportsSessionTodos: () => false,
      updateSession: harness.updateSession,
    });

    await loadSessionTodos("external-1", repoPath, "opencode", workingDirectory);

    expect(loadSessionTodosCalled).toBe(false);
    expect(harness.getState()["external-1"]?.todos).toEqual([]);
  });
});

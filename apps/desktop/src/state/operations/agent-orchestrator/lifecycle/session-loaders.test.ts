import { describe, expect, test } from "bun:test";
import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
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
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt: "2026-03-01T09:00:00.000Z",
  runtimeId: "runtime-1",
  runId: "run-1",
  runtimeEndpoint: "http://127.0.0.1:4444",
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
    [session.sessionId]: session,
  };
  const updateSession = (
    sessionId: string,
    updater: (current: AgentSessionState) => AgentSessionState,
  ): void => {
    const current = state[sessionId];
    if (!current) {
      return;
    }
    const next = updater(current);
    state = {
      ...state,
      [sessionId]: next,
    };
  };
  return {
    getState: () => state,
    updateSession,
  };
};

const runtimeConnection = {
  endpoint: "http://127.0.0.1:4444",
  workingDirectory: "/tmp/repo",
} as const;

describe("agent-orchestrator/lifecycle/session-loaders", () => {
  test("loads model catalog and clears loading state", async () => {
    const deferredCatalog = createDeferred<AgentModelCatalog>();
    const harness = createStateHarness(createSession());
    const loadSessionModelCatalog = createLoadSessionModelCatalog({
      adapter: {
        listAvailableModels: async () => deferredCatalog.promise,
        loadSessionTodos: async () => [],
      },
      updateSession: harness.updateSession,
    });

    const loadPromise = loadSessionModelCatalog("session-1", "opencode", runtimeConnection);

    expect(harness.getState()["session-1"]?.isLoadingModelCatalog).toBe(true);

    deferredCatalog.resolve(catalogFixture);
    await loadPromise;

    const session = harness.getState()["session-1"];
    expect(session?.isLoadingModelCatalog).toBe(false);
    expect(session?.modelCatalog).toEqual(catalogFixture);
    expect(session?.selectedModel).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });
  });

  test("records model catalog errors in session messages", async () => {
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

    await loadSessionModelCatalog("session-1", "opencode", runtimeConnection);

    const session = harness.getState()["session-1"];
    expect(session?.isLoadingModelCatalog).toBe(false);
    expect(session?.messages[0]?.id).toBe("model-catalog:session-1");
    expect(session?.messages[0]?.content).toContain("Model catalog unavailable: catalog failed");
  });

  test("rejects invalid model catalog runtime runtimeEndpoint before adapter call", async () => {
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

    await loadSessionModelCatalog("session-1", "opencode", {
      endpoint: "https://example.com:4444",
      workingDirectory: "/tmp/repo",
    });

    const session = harness.getState()["session-1"];
    expect(listAvailableModelsCalled).toBe(false);
    expect(session?.isLoadingModelCatalog).toBe(false);
    expect(session?.messages[0]?.content).toContain(
      "Model catalog unavailable: Session runtime runtimeEndpoint must use the http protocol.",
    );
  });

  test("loads todos and merges while preserving existing order", async () => {
    const harness = createStateHarness(
      createSession({}, [
        { id: "a", content: "A", status: "pending", priority: "medium" },
        { id: "b", content: "B", status: "pending", priority: "medium" },
      ]),
    );
    const loadSessionTodos = createLoadSessionTodos({
      adapter: {
        listAvailableModels: async () => catalogFixture,
        loadSessionTodos: async () => [
          { id: "b", content: "B updated", status: "in_progress", priority: "high" },
          { id: "c", content: "C", status: "pending", priority: "low" },
          { id: "a", content: "A updated", status: "completed", priority: "medium" },
        ],
      },
      supportsSessionTodos: () => true,
      updateSession: harness.updateSession,
    });

    await loadSessionTodos("session-1", "opencode", runtimeConnection, "external-1");

    const mergedTodos = harness.getState()["session-1"]?.todos ?? [];
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
      loadSessionTodos(
        "session-1",
        "opencode",
        {
          endpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/../escape",
        },
        "external-1",
      ),
    ).rejects.toThrow("Session runtime workingDirectory must not contain traversal segments.");
    expect(loadSessionTodosCalled).toBe(false);
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

    await loadSessionTodos("session-1", "opencode", runtimeConnection, "external-1");

    expect(loadSessionTodosCalled).toBe(false);
    expect(harness.getState()["session-1"]?.todos).toEqual([]);
  });
});

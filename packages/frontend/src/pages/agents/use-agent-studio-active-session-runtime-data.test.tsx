import { describe, expect, mock, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  createAgentSessionFixture,
  createDeferred,
  createHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioActiveSessionRuntimeData } from "./use-agent-studio-active-session-runtime-data";

enableReactActEnvironment();

const CATALOG: AgentModelCatalog = {
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default"],
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
};

describe("useAgentStudioActiveSessionRuntimeData", () => {
  test("does not query runtime data while the session is still starting", async () => {
    const readSessionModelCatalog = mock(async () => CATALOG);
    const readSessionTodos = mock(async () => []);
    const harness = createHookHarness(useAgentStudioActiveSessionRuntimeData, {
      session: createAgentSessionFixture({
        sessionId: "session-1",
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/repo",
        status: "starting",
        modelCatalog: null,
        isLoadingModelCatalog: true,
      }),
      agentStudioReadinessState: "ready",
      readSessionModelCatalog,
      readSessionTodos,
    });

    try {
      await harness.mount();

      expect(readSessionModelCatalog).not.toHaveBeenCalled();
      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(harness.getLatest()?.session?.isLoadingModelCatalog).toBe(true);
      expect(harness.getLatest()?.runtimeDataError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("clears sticky model-catalog loading once the runtime query resolves", async () => {
    const catalogLoad = createDeferred<AgentModelCatalog>();
    const readSessionModelCatalog = mock(() => catalogLoad.promise);
    const readSessionTodos = mock(async () => []);
    const harness = createHookHarness(useAgentStudioActiveSessionRuntimeData, {
      session: createAgentSessionFixture({
        sessionId: "session-1",
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/repo",
        modelCatalog: null,
        isLoadingModelCatalog: true,
      }),
      agentStudioReadinessState: "ready",
      readSessionModelCatalog,
      readSessionTodos,
    });

    try {
      await harness.mount();

      expect(harness.getLatest()?.session?.isLoadingModelCatalog).toBe(true);
      expect(readSessionModelCatalog).toHaveBeenCalledTimes(1);

      catalogLoad.resolve(CATALOG);
      await harness.waitFor(
        (state) => state.session !== null && state.session.isLoadingModelCatalog === false,
      );

      expect(harness.getLatest()?.session?.modelCatalog).toEqual(CATALOG);
      expect(harness.getLatest()?.session?.isLoadingModelCatalog).toBe(false);
      expect(harness.getLatest()?.runtimeDataError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("waits for readiness before querying runtime-backed session data", async () => {
    const readSessionModelCatalog = mock(async () => CATALOG);
    const readSessionTodos = mock(async () => []);
    const session = createAgentSessionFixture({
      sessionId: "session-1",
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      workingDirectory: "/repo",
      modelCatalog: null,
      isLoadingModelCatalog: true,
    });
    const harness = createHookHarness(useAgentStudioActiveSessionRuntimeData, {
      session,
      agentStudioReadinessState: "checking",
      readSessionModelCatalog,
      readSessionTodos,
    });

    try {
      await harness.mount();

      expect(readSessionModelCatalog).not.toHaveBeenCalled();
      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(harness.getLatest()?.session?.isLoadingModelCatalog).toBe(true);

      await harness.update({
        session,
        agentStudioReadinessState: "ready",
        readSessionModelCatalog,
        readSessionTodos,
      });
      await harness.waitFor((state) =>
        Boolean(
          state.session?.modelCatalog?.models[0]?.id === CATALOG.models[0]?.id &&
            state.session?.isLoadingModelCatalog === false,
        ),
      );

      expect(readSessionModelCatalog).toHaveBeenCalledTimes(1);
      expect(readSessionTodos).toHaveBeenCalledTimes(1);
      expect(harness.getLatest()?.session?.modelCatalog).toEqual(CATALOG);
      expect(harness.getLatest()?.session?.isLoadingModelCatalog).toBe(false);
      expect(harness.getLatest()?.runtimeDataError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces an explicit error for unsupported stdio OpenCode session runtime data", async () => {
    const readSessionModelCatalog = mock(async () => CATALOG);
    const readSessionTodos = mock(async () => []);
    const harness = createHookHarness(useAgentStudioActiveSessionRuntimeData, {
      session: createAgentSessionFixture({
        sessionId: "session-1",
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        runtimeRoute: { type: "stdio", identity: "runtime-stdio" },
        workingDirectory: "/repo",
        modelCatalog: null,
        isLoadingModelCatalog: false,
      }),
      agentStudioReadinessState: "ready",
      readSessionModelCatalog,
      readSessionTodos,
    });

    try {
      await harness.mount();

      expect(readSessionModelCatalog).not.toHaveBeenCalled();
      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(harness.getLatest()?.session?.isLoadingModelCatalog).toBe(false);
      expect(harness.getLatest()?.runtimeDataError).toContain("local_http is required");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps model-catalog loading active while todos fail but catalog hydration is still pending", async () => {
    const catalogLoad = createDeferred<AgentModelCatalog>();
    const readSessionModelCatalog = mock(() => catalogLoad.promise);
    const readSessionTodos = mock(async () => {
      throw new Error("todos unavailable");
    });
    const harness = createHookHarness(useAgentStudioActiveSessionRuntimeData, {
      session: createAgentSessionFixture({
        sessionId: "session-1",
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/repo",
        modelCatalog: null,
        isLoadingModelCatalog: true,
      }),
      agentStudioReadinessState: "ready",
      readSessionModelCatalog,
      readSessionTodos,
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.runtimeDataError === "todos unavailable" &&
          state.session?.isLoadingModelCatalog === true,
      );

      expect(harness.getLatest()?.session?.modelCatalog).toBeNull();

      catalogLoad.resolve(CATALOG);
      await harness.waitFor(
        (state) =>
          state.runtimeDataError === "todos unavailable" &&
          state.session?.isLoadingModelCatalog === false &&
          state.session?.modelCatalog?.models[0]?.id === CATALOG.models[0]?.id,
      );
    } finally {
      await harness.unmount();
    }
  });
});

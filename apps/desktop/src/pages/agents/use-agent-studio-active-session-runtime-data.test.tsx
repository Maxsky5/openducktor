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
  test("clears sticky model-catalog loading once the runtime query resolves", async () => {
    const catalogLoad = createDeferred<AgentModelCatalog>();
    const readSessionModelCatalog = mock(() => catalogLoad.promise);
    const readSessionTodos = mock(async () => []);
    const harness = createHookHarness(useAgentStudioActiveSessionRuntimeData, {
      session: createAgentSessionFixture({
        sessionId: "session-1",
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/repo",
        modelCatalog: null,
        isLoadingModelCatalog: true,
      }),
      readSessionModelCatalog,
      readSessionTodos,
    });

    try {
      await harness.mount();

      expect(harness.getLatest()?.isLoadingModelCatalog).toBe(true);
      expect(readSessionModelCatalog).toHaveBeenCalledTimes(1);

      catalogLoad.resolve(CATALOG);
      await harness.waitFor((state) => state !== null && state.isLoadingModelCatalog === false);

      expect(harness.getLatest()?.modelCatalog).toEqual(CATALOG);
      expect(harness.getLatest()?.isLoadingModelCatalog).toBe(false);
    } finally {
      await harness.unmount();
    }
  });
});

import "../../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { renderHook } from "@testing-library/react";
import { useSelectedSessionContextUsage } from "./use-selected-session-context-usage";

const MODEL: AgentModelCatalog["models"][number] = {
  id: "openai/gpt-5",
  providerId: "openai",
  providerName: "OpenAI",
  modelId: "gpt-5",
  modelName: "GPT-5",
  variants: ["default"],
  contextWindow: 200_000,
  outputLimit: 8_192,
};

const CATALOG: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [MODEL],
  defaultModelsByProvider: { openai: "gpt-5" },
  profiles: [],
};

describe("useSelectedSessionContextUsage", () => {
  test("reads the window of the selected model when the runtime reports none", () => {
    const view = renderHook(() =>
      useSelectedSessionContextUsage({
        contextUsage: { totalTokens: 1_000 },
        catalog: null,
        selectedModelEntry: MODEL,
      }),
    );
    expect(view.result.current).toEqual({
      totalTokens: 1_000,
      contextWindow: 200_000,
      outputLimit: 8_192,
    });
    view.unmount();
  });

  test("reads the window of the reported model from the catalog", () => {
    const view = renderHook(() =>
      useSelectedSessionContextUsage({
        contextUsage: { totalTokens: 44, providerId: "openai", modelId: "gpt-5" },
        catalog: CATALOG,
        selectedModelEntry: null,
      }),
    );
    expect(view.result.current).toEqual({
      totalTokens: 44,
      contextWindow: 200_000,
      outputLimit: 8_192,
    });
    view.unmount();
  });

  test("has no usage before the runtime reports one", () => {
    const view = renderHook(() =>
      useSelectedSessionContextUsage({
        contextUsage: null,
        catalog: CATALOG,
        selectedModelEntry: MODEL,
      }),
    );
    expect(view.result.current).toBeNull();
    view.unmount();
  });
});

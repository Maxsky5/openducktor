import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { ModelPickerRuntime } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import { useModelPicker } from "./use-model-picker";

type Input = Parameters<typeof useModelPicker>[0];

const inputs = (): Input => ({
  visible: true,
  selection: { runtimeKind: "opencode", providerId: "openai", modelId: "model" },
  favorites: [],
  lock: null,
  runtimes: [
    {
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      isEnabledForFavorites: true,
      resource: {
        status: "ready",
        catalog: {
          models: [
            {
              id: "openai/model",
              providerId: "openai",
              providerName: "OpenAI",
              modelId: "model",
              modelName: "Ready model",
              variants: [],
            },
          ],
          defaultModelsByProvider: {},
        },
      },
    },
    {
      descriptor: CODEX_RUNTIME_DESCRIPTOR,
      isEnabledForFavorites: true,
      resource: { status: "loading", catalog: null, retry: async () => {} },
    },
  ],
});

const pending = (runtime: ModelPickerRuntime): ModelPickerRuntime => ({
  ...runtime,
  resource: { status: "loading", catalog: null, retry: async () => {} },
});

describe("useModelPicker", () => {
  test("does not read model entries before opening and keeps the list through close", async () => {
    const input = inputs();
    input.visible = false;
    const resource = input.runtimes[0]?.resource;
    if (resource?.status !== "ready") throw new Error("The fixture needs a ready catalog.");
    const models = resource.catalog.models;
    let reads = 0;
    Object.defineProperty(resource.catalog, "models", {
      get: () => {
        reads++;
        return models;
      },
    });
    const harness = createHookHarness(useModelPicker, input);
    try {
      await harness.mount();
      expect(reads).toBe(0);
      await harness.update({ ...input, visible: true });
      const rows = harness.getLatest().rows;
      expect(rows.some((row) => row.type === "model")).toBe(true);
      expect(reads).toBeGreaterThan(0);
      await harness.update(input);
      expect(harness.getLatest().rows).toEqual(rows);
    } finally {
      await harness.unmount();
    }
  });

  test.each([false, true])(
    "shows a ready model without waiting for another runtime, locked=%s",
    async (locked) => {
      const input = inputs();
      if (locked) input.lock = { runtimeKind: "opencode", reason: "Keep the session runtime." };
      const harness = createHookHarness(useModelPicker, input);
      try {
        await harness.mount();
        expect(
          harness
            .getLatest()
            .rows.some((row) => row.type === "model" && row.item.model.modelName === "Ready model"),
        ).toBe(true);
        expect(harness.getLatest().loading).toBe(false);
      } finally {
        await harness.unmount();
      }
    },
  );

  test("waits for the locked runtime even when another runtime has models", async () => {
    const input = inputs();
    input.lock = { runtimeKind: "codex", reason: "Keep the session runtime." };
    const harness = createHookHarness(useModelPicker, input);
    try {
      await harness.mount();
      expect(harness.getLatest().loading).toBe(true);
      expect(harness.getLatest().rows.some((row) => row.type === "model")).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("loads missing catalogs once and keeps the frame during search, tab changes, and retry", async () => {
    const ready = inputs();
    const cold: Input = { ...ready, runtimes: ready.runtimes.map(pending) };
    const harness = createHookHarness(useModelPicker, cold);
    try {
      await harness.mount();
      expect(harness.getLatest().loading).toBe(true);
      await harness.update(ready);
      expect(harness.getLatest().loading).toBe(false);
      await harness.run((picker) => {
        picker.setQuery("model");
        picker.setView("codex");
      });
      await harness.update(cold);
      expect(harness.getLatest().loading).toBe(false);
      await harness.update({ ...cold, visible: false });
      expect(harness.getLatest().query).toBe("model");
      await harness.update(ready);
      expect(harness.getLatest().query).toBe("");
      expect(harness.getLatest().view).toBe("opencode");
      expect(harness.getLatest().loading).toBe(false);
    } finally {
      await harness.unmount();
    }
  });
});

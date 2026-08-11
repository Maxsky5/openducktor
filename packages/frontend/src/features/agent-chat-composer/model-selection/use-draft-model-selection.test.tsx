import { describe, expect, test } from "bun:test";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useDraftModelSelectionState } from "./use-draft-model-selection";

type HookArgs = Parameters<typeof useDraftModelSelectionState>[0];

const createSelection = (modelId: string): AgentModelSelection => ({
  runtimeKind: "codex",
  providerId: "openai",
  modelId,
});

const createBaseProps = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  contextKey: "/repo-a",
  isDefaultSelectionReady: false,
  selectionKey: "repository-chat",
  ...overrides,
});

const catalog: AgentModelCatalog = {
  models: [
    {
      id: "openai/model-a",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "model-a",
      modelName: "Model A",
      variants: [],
    },
  ],
  defaultModelsByProvider: {
    openai: "model-a",
  },
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useDraftModelSelectionState, initialProps);

describe("useDraftModelSelectionState", () => {
  test("does not resurrect an old repo draft after an intervening repo switch", async () => {
    const selectionA = createSelection("model-a");
    const selectionB = createSelection("model-b");
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.run((state) => {
      state.applyDraftSelection(selectionA);
    });
    expect(harness.getLatest().draftSelection).toEqual(selectionA);

    await harness.update(createBaseProps({ contextKey: "/repo-b" }));
    expect(harness.getLatest().draftSelection).toBeNull();

    await harness.run((state) => {
      state.applyDraftSelection(selectionB);
    });
    expect(harness.getLatest().draftSelection).toEqual(selectionB);

    await harness.update(createBaseProps({ contextKey: "/repo-a" }));
    expect(harness.getLatest().draftSelection).toBeNull();

    await harness.unmount();
  });

  test("syncs caller defaults only when the catalog exists", async () => {
    const selection = createSelection("model-a");
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.run((state) => {
      state.syncDraftSelection({
        catalog: null,
        defaultSelection: selection,
      });
    });
    expect(harness.getLatest().draftSelection).toBeNull();

    await harness.run((state) => {
      state.syncDraftSelection({
        catalog,
        defaultSelection: selection,
      });
    });
    expect(harness.getLatest().draftSelection).toEqual(selection);

    await harness.unmount();
  });
});

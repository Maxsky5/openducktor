import { describe, expect, test } from "bun:test";
import type { AgentModelSelection } from "@openducktor/core";
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
  defaultSelection: null,
  isDefaultSelectionReady: false,
  selectionKey: "repository-chat",
  ...overrides,
});

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

  test("discards a repo draft even when the intervening repo is not edited", async () => {
    const selection = createSelection("model-a");
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.run((state) => {
      state.applyDraftSelection(selection);
    });

    await harness.update(createBaseProps({ contextKey: "/repo-b" }));
    expect(harness.getLatest().draftSelection).toBeNull();

    await harness.update(createBaseProps({ contextKey: "/repo-a" }));
    expect(harness.getLatest().draftSelection).toBeNull();

    await harness.unmount();
  });

  test("resolves a caller default on the first render without an imperative sync", async () => {
    const selection = createSelection("model-a");
    const harness = createHookHarness(
      createBaseProps({
        defaultSelection: selection,
        isDefaultSelectionReady: true,
      }),
    );

    await harness.mount();
    expect(harness.getLatest().draftSelection).toEqual(selection);

    await harness.unmount();
  });

  test("resolves a ready caller default before the catalog loads", async () => {
    const selection = createSelection("model-a");
    const harness = createHookHarness(
      createBaseProps({
        defaultSelection: selection,
      }),
    );

    await harness.mount();
    expect(harness.getLatest().draftSelection).toBeNull();

    await harness.update(
      createBaseProps({
        defaultSelection: selection,
        isDefaultSelectionReady: true,
      }),
    );
    expect(harness.getLatest().draftSelection).toEqual(selection);

    await harness.unmount();
  });

  test("does not expose an imperative catalog sync command", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    expect(harness.getLatest()).not.toHaveProperty("syncDraftSelection");

    await harness.unmount();
  });
});

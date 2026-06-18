import { describe, expect, test } from "bun:test";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useAgentStudioDraftModelSelectionState } from "./use-draft-model-selection";

type HookArgs = Parameters<typeof useAgentStudioDraftModelSelectionState>[0];

const createSelection = (modelId: string): AgentModelSelection => ({
  runtimeKind: "codex",
  providerId: "openai",
  modelId,
});

const createBaseProps = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  workspaceRepoPath: "/repo-a",
  repoSettings: null,
  role: "build" satisfies AgentRole,
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
  createSharedHookHarness(useAgentStudioDraftModelSelectionState, initialProps);

describe("useAgentStudioDraftModelSelectionState", () => {
  test("does not resurrect an old repo draft after an intervening repo switch", async () => {
    const selectionA = createSelection("model-a");
    const selectionB = createSelection("model-b");
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.run((state) => {
      state.applyDraftSelection(selectionA);
    });
    expect(harness.getLatest().draftSelection).toEqual(selectionA);

    await harness.update(createBaseProps({ workspaceRepoPath: "/repo-b" }));
    expect(harness.getLatest().draftSelection).toBeNull();

    await harness.run((state) => {
      state.applyDraftSelection(selectionB);
    });
    expect(harness.getLatest().draftSelection).toEqual(selectionB);

    await harness.update(createBaseProps({ workspaceRepoPath: "/repo-a" }));
    expect(harness.getLatest().draftSelection).toBeNull();

    await harness.unmount();
  });

  test("syncs role defaults from the repo composer catalog only when that catalog exists", async () => {
    const selection = createSelection("model-a");
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.run((state) => {
      state.syncDraftSelection({
        composerCatalog: null,
        roleDefaultSelection: selection,
      });
    });
    expect(harness.getLatest().draftSelection).toBeNull();

    await harness.run((state) => {
      state.syncDraftSelection({
        composerCatalog: catalog,
        roleDefaultSelection: selection,
      });
    });
    expect(harness.getLatest().draftSelection).toEqual(selection);

    await harness.unmount();
  });
});

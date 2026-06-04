import { describe, expect, test } from "bun:test";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
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
});

import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import {
  createDraftModelSelectionState,
  draftModelSelectionReducer,
  resolveInitialModelSelection,
  resolveModelSelectionForModelChange,
  resolveModelSelectionForProfileChange,
  resolveModelSelectionForRuntimeChange,
  resolveModelSelectionForVariantChange,
  resolvePreferredModelSelection,
} from "./model-selection-state";

const CATALOG: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default", "high"],
    },
    {
      id: "anthropic/claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: ["standard"],
    },
  ],
  defaultModelsByProvider: { openai: "gpt-5" },
  profiles: [
    { id: "reviewer", name: "Reviewer", mode: "primary", hidden: false },
    { id: "hidden-helper", name: "Hidden helper", mode: "subagent", hidden: true },
  ],
};

const EXPLICIT_SELECTION: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "anthropic",
  modelId: "claude-sonnet",
  variant: "standard",
  profileId: "reviewer",
};

describe("model-selection-state", () => {
  test("starts from an explicit caller selection without a workflow role", () => {
    expect(
      resolveInitialModelSelection({
        catalog: CATALOG,
        defaultSelection: null,
        runtimeKind: "opencode",
        selectedModel: EXPLICIT_SELECTION,
      }),
    ).toEqual(EXPLICIT_SELECTION);

    const { runtimeKind: _runtimeKind, ...selectionWithoutRuntime } = EXPLICIT_SELECTION;
    expect(
      resolveInitialModelSelection({
        catalog: CATALOG,
        defaultSelection: null,
        runtimeKind: "opencode",
        selectedModel: selectionWithoutRuntime,
      }),
    ).toEqual(EXPLICIT_SELECTION);
  });

  test("supports no caller default and still requires an explicit runtime", () => {
    expect(
      resolveInitialModelSelection({
        catalog: CATALOG,
        defaultSelection: null,
        runtimeKind: null,
        selectedModel: null,
      }),
    ).toBeNull();
    expect(
      resolveInitialModelSelection({
        catalog: CATALOG,
        defaultSelection: null,
        runtimeKind: "opencode",
        selectedModel: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "reviewer",
    });
    expect(
      resolveInitialModelSelection({
        catalog: null,
        defaultSelection: null,
        runtimeKind: "opencode",
        selectedModel: null,
      }),
    ).toBeNull();
  });

  test("changes runtime from caller-owned inputs without a workflow role", () => {
    expect(
      resolveModelSelectionForRuntimeChange({
        currentSelection: EXPLICIT_SELECTION,
        defaultSelection: {
          runtimeKind: "claude",
          providerId: "anthropic",
          modelId: "claude-sonnet",
        },
        selectedModel: null,
        runtimeKind: "claude",
      }),
    ).toEqual({
      runtimeKind: "claude",
      providerId: "anthropic",
      modelId: "claude-sonnet",
    });
    expect(
      resolveModelSelectionForRuntimeChange({
        currentSelection: EXPLICIT_SELECTION,
        defaultSelection: null,
        selectedModel: null,
        runtimeKind: "claude",
      }),
    ).toBeNull();
  });

  test("changes model and normalizes the variant while preserving the runtime profile", () => {
    expect(
      resolveModelSelectionForModelChange({
        catalog: CATALOG,
        currentSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "reviewer",
        },
        modelKey: "anthropic/claude-sonnet",
        runtimeKind: "opencode",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "standard",
      profileId: "reviewer",
    });

    expect(
      resolveModelSelectionForModelChange({
        catalog: {
          ...CATALOG,
          models: [
            {
              id: "runtime-model-o3",
              providerId: "openai",
              providerName: "OpenAI",
              modelId: "o3",
              modelName: "o3",
              variants: ["low", "high"],
            },
          ],
        },
        currentSelection: null,
        modelKey: "openai/o3",
        runtimeKind: "opencode",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "o3",
      variant: "low",
    });
  });

  test("normalizes an invalid variant against the selected catalog model", () => {
    expect(
      resolveModelSelectionForVariantChange({
        catalog: CATALOG,
        currentSelection: EXPLICIT_SELECTION,
        variant: "removed",
      }),
    ).toEqual(EXPLICIT_SELECTION);
  });

  test("selects visible runtime profiles and rejects hidden profiles", () => {
    expect(
      resolveModelSelectionForProfileChange({
        catalog: CATALOG,
        currentSelection: EXPLICIT_SELECTION,
        profileId: "reviewer",
        runtimeKind: "opencode",
      }),
    ).toEqual(EXPLICIT_SELECTION);
    expect(
      resolveModelSelectionForProfileChange({
        catalog: CATALOG,
        currentSelection: EXPLICIT_SELECTION,
        profileId: "hidden-helper",
        runtimeKind: "opencode",
      }),
    ).toEqual(EXPLICIT_SELECTION);
  });

  test("normalizes a draft after a catalog reload and removes missing selected values", () => {
    const staleSelection: AgentModelSelection = {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "removed",
      profileId: "removed-profile",
    };
    const initialState = createDraftModelSelectionState({
      contextKey: "/repo",
      isDefaultSelectionReady: true,
    });
    const touchedState = draftModelSelectionReducer(initialState, {
      type: "draftSelectionApplied",
      contextKey: "/repo",
      isDefaultSelectionReady: true,
      selection: staleSelection,
      selectionKey: "repository-chat",
    });
    const reloadedState = draftModelSelectionReducer(touchedState, {
      type: "draftSelectionSynced",
      catalog: CATALOG,
      contextKey: "/repo",
      defaultSelection: null,
      isDefaultSelectionReady: true,
      selectionKey: "repository-chat",
    });

    expect(reloadedState.draftSelections["repository-chat"]).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
    });
    expect(
      resolvePreferredModelSelection({
        catalog: CATALOG,
        preferredSelection: staleSelection,
        fallbackSelection: null,
      }),
    ).toEqual(reloadedState.draftSelections["repository-chat"] ?? null);
  });

  test("feeds workflow and non-workflow defaults through the same reducer interface", () => {
    const initialState = createDraftModelSelectionState({
      contextKey: "/repo",
      isDefaultSelectionReady: true,
    });
    const syncDefault = (selectionKey: string, defaultSelection: AgentModelSelection) =>
      draftModelSelectionReducer(initialState, {
        type: "draftSelectionSynced",
        catalog: CATALOG,
        contextKey: "/repo",
        defaultSelection,
        isDefaultSelectionReady: true,
        selectionKey,
      });

    const workflowState = syncDefault("build", EXPLICIT_SELECTION);
    const repositoryChatState = syncDefault("repository-chat", EXPLICIT_SELECTION);

    expect(workflowState.draftSelections.build).toEqual(EXPLICIT_SELECTION);
    expect(repositoryChatState.draftSelections["repository-chat"]).toEqual(EXPLICIT_SELECTION);
  });
});

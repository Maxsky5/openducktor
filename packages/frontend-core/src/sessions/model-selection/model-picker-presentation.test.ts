import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type {
  ModelPickerFavoriteState,
  ModelPickerItem,
  ModelPickerRuntime,
} from "./model-picker-model";
import {
  modelPickerFavoriteDisabledReason,
  modelPickerMetadataDescription,
  resolveModelPickerActiveView,
  resolveModelPickerPresentation,
} from "./model-picker-presentation";

const model: AgentModelCatalog["models"][number] = {
  id: "openai/gpt-5",
  providerId: "openai",
  providerName: "OpenAI",
  modelId: "gpt-5",
  modelName: "GPT-5",
  variants: [],
  contextWindow: 400_000,
  attachmentSupport: { image: true, video: false, audio: false, pdf: true },
};

const runtime = (
  descriptor: RuntimeDescriptor,
  isEnabledForFavorites = true,
): ModelPickerRuntime => ({
  descriptor,
  isEnabledForFavorites,
  resource: { status: "ready", catalog: { models: [model], defaultModelsByProvider: {} } },
});

const favoriteState = (
  overrides: Partial<ModelPickerFavoriteState> = {},
): ModelPickerFavoriteState => ({
  favorites: [],
  isLoading: false,
  readError: null,
  isMutationPending: false,
  mutationError: null,
  canMutate: true,
  toggleFavorite: () => {},
  retryRead: () => {},
  retryMutation: () => {},
  ...overrides,
});

describe("resolveModelPickerActiveView", () => {
  const runtimes = [runtime(OPENCODE_RUNTIME_DESCRIPTOR), runtime(CLAUDE_RUNTIME_DESCRIPTOR)];
  const claudeFavorite = { runtimeKind: "claude" as const, providerId: "openai", modelId: "gpt-5" };

  test("opens favorites when a usable runtime has one", () => {
    expect(resolveModelPickerActiveView(runtimes, [claudeFavorite], { kind: "editable" })).toBe(
      "favorites",
    );
  });

  test("opens the first runtime that can show favorites when no favorite exists", () => {
    expect(resolveModelPickerActiveView(runtimes, [], { kind: "editable" })).toBe("opencode");
    expect(
      resolveModelPickerActiveView(
        [runtime(OPENCODE_RUNTIME_DESCRIPTOR, false), runtime(CLAUDE_RUNTIME_DESCRIPTOR)],
        [],
        { kind: "editable" },
      ),
    ).toBe("claude");
  });

  test("keeps a locked runtime unless it has a favorite", () => {
    const locked = {
      kind: "runtime_locked" as const,
      runtimeKind: "opencode" as const,
      reason: "x",
    };
    expect(resolveModelPickerActiveView(runtimes, [claudeFavorite], locked)).toBe("opencode");
    expect(
      resolveModelPickerActiveView(
        runtimes,
        [{ ...claudeFavorite, runtimeKind: "opencode" }],
        locked,
      ),
    ).toBe("favorites");
  });
});

describe("resolveModelPickerPresentation", () => {
  test("names the selected runtime and model in the trigger", () => {
    const presentation = resolveModelPickerPresentation({
      runtimes: [runtime(OPENCODE_RUNTIME_DESCRIPTOR)],
      value: { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
      placeholder: "Select a model",
      activeView: "opencode",
      searchQuery: "",
      favoriteState: favoriteState(),
      lockedRuntimeKind: null,
    });
    expect(presentation.triggerModelLabel).toBe("GPT-5");
    expect(presentation.triggerAriaLabel).toBe(
      `Select model, ${OPENCODE_RUNTIME_DESCRIPTOR.label}, GPT-5`,
    );
  });

  test("explains an empty favorites view and an empty search", () => {
    const input = {
      runtimes: [runtime(OPENCODE_RUNTIME_DESCRIPTOR)],
      value: null,
      placeholder: "Select a model",
      activeView: "favorites" as const,
      searchQuery: "",
      lockedRuntimeKind: null,
    };
    expect(
      resolveModelPickerPresentation({
        ...input,
        favoriteState: favoriteState({ isLoading: true }),
      }).emptyMessage,
    ).toBe("Loading favorites...");
    expect(
      resolveModelPickerPresentation({ ...input, favoriteState: favoriteState() }).emptyMessage,
    ).toBe("No favorite models are available here. Use a model row's star to add one.");
    expect(
      resolveModelPickerPresentation({
        ...input,
        searchQuery: "missing",
        favoriteState: favoriteState(),
      }).emptyMessage,
    ).toBe("No models match your search.");
  });
});

describe("model row text", () => {
  test("describes the context window and attachment support", () => {
    // SAFETY: The description reads only the model of the item.
    const item = { model } as ModelPickerItem;
    expect(modelPickerMetadataDescription(item)).toBe(
      "400K token context window. Supports images, pdf files",
    );
  });

  test("explains why favorites cannot change", () => {
    expect(modelPickerFavoriteDisabledReason(favoriteState())).toBeNull();
    expect(
      modelPickerFavoriteDisabledReason(favoriteState({ canMutate: false, readError: "Offline" })),
    ).toBe("Favorites unavailable: Offline");
    expect(
      modelPickerFavoriteDisabledReason(
        favoriteState({ canMutate: false, isMutationPending: true }),
      ),
    ).toBe("Saving favorite changes.");
  });
});

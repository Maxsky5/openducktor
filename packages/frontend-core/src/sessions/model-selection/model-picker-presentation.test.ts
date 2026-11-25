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
  blockedSpeedReason,
  modelPickerFavoriteDisabledReason,
  modelPickerMetadataDescription,
  resolveModelPickerActiveView,
  resolveModelPickerPresentation,
  resolveModelTriggerSummary,
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

  test("opens the selected runtime when editable with no favorites", () => {
    expect(resolveModelPickerActiveView(runtimes, [], { kind: "editable" }, "claude")).toBe(
      "claude",
    );
    expect(
      resolveModelPickerActiveView(runtimes, [claudeFavorite], { kind: "editable" }, "claude"),
    ).toBe("favorites");
    expect(resolveModelPickerActiveView(runtimes, [], { kind: "editable" }, "codex")).toBe(
      "opencode",
    );
  });

  test("keeps a locked runtime unless it has a favorite", () => {
    const locked = {
      kind: "runtime_locked" as const,
      runtimeKind: "opencode" as const,
      reason: "x",
    };
    expect(resolveModelPickerActiveView(runtimes, [claudeFavorite], locked, "claude")).toBe(
      "opencode",
    );
    expect(
      resolveModelPickerActiveView(
        runtimes,
        [{ ...claudeFavorite, runtimeKind: "opencode" }],
        locked,
        "claude",
      ),
    ).toBe("favorites");
  });
});

describe("resolveModelPickerPresentation", () => {
  test("scopes visible resources to the active runtime or locked runtime", () => {
    const presentation = resolveModelPickerPresentation({
      runtimes: [runtime(OPENCODE_RUNTIME_DESCRIPTOR), runtime(CLAUDE_RUNTIME_DESCRIPTOR)],
      activeView: "opencode",
      searchQuery: "",
      favoriteState: favoriteState(),
      lockedRuntimeKind: null,
    });
    expect(presentation.visibleResources.map((entry) => entry.descriptor.kind)).toEqual([
      "opencode",
    ]);
  });

  test("explains an empty favorites view and an empty search", () => {
    const input = {
      runtimes: [runtime(OPENCODE_RUNTIME_DESCRIPTOR)],
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

describe("resolveModelTriggerSummary", () => {
  test("merges OpenCode profile, model, and effort while omitting speed", () => {
    const summary = resolveModelTriggerSummary({
      runtime: OPENCODE_RUNTIME_DESCRIPTOR,
      catalog: {
        models: [
          {
            ...model,
            variants: ["low", "high"],
          },
        ],
        defaultModelsByProvider: {},
        profiles: [{ name: "builder", label: "Builder", mode: "primary" }],
      },
      selection: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "builder",
        variant: "high",
      },
      disabledReason: "Saving model selection...",
    });

    expect(summary.profileLabel).toBe("Builder");
    expect(summary.modelLabel).toBe("GPT-5");
    expect(summary.effortLabel).toBe("high");
    expect(summary.speedLabel).toBeNull();
    expect(summary.speedTone).toBe("standard");
    expect(summary.ariaLabel).toBe(
      `Select model, ${OPENCODE_RUNTIME_DESCRIPTOR.label}, Builder, GPT-5, Effort high. Saving model selection...`,
    );
  });

  test("resolves fast and ultrafast speed tones and blocked speed reason", () => {
    const summary = resolveModelTriggerSummary({
      runtime: CLAUDE_RUNTIME_DESCRIPTOR,
      catalog: {
        models: [
          {
            ...model,
            providerId: "claude",
            modelId: "claude-opus-4-6",
            modelName: "Claude Opus 4.6",
            variants: ["high"],
            speedLevels: [
              { id: "fast", label: "Fast" },
              { id: "ultrafast", label: "Ultrafast" },
            ],
          },
        ],
        defaultModelsByProvider: {},
      },
      selection: {
        runtimeKind: "claude",
        providerId: "claude",
        modelId: "claude-opus-4-6",
        variant: "high",
        speed: "ultrafast",
      },
    });

    expect(summary.speedTone).toBe("ultrafast");
    expect(summary.speedLabel).toBe("Ultrafast");
    expect(summary.nonStandardSpeedLabel).toBe("Ultrafast");
    expect(
      blockedSpeedReason({ choice: "ultrafast", blockedReason: "Account cannot use fast mode." }),
    ).toBe("Account cannot use fast mode.");
    expect(
      blockedSpeedReason({ choice: "standard", blockedReason: "Account cannot use fast mode." }),
    ).toBeNull();
  });

  test("locks speed_only policy to the target runtime view", () => {
    const runtimes = [runtime(OPENCODE_RUNTIME_DESCRIPTOR), runtime(CLAUDE_RUNTIME_DESCRIPTOR)];
    expect(
      resolveModelPickerActiveView(
        runtimes,
        [{ runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" }],
        { kind: "speed_only", runtimeKind: "claude", reason: "Reused session" },
      ),
    ).toBe("claude");
  });
});

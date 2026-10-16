import { describe, expect, test } from "bun:test";
import {
  type AgentModelFavorite,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ModelPickerCatalogResource, ModelPickerRuntime } from "./model-picker-model";
import {
  buildModelPickerItems,
  isSameModelPickerValue,
  modelPickerResourceFromCatalogQuery,
  modelPickerValueKey,
  toModelPickerCatalogResource,
} from "./model-picker-model";

const catalog = (runtimeKind: "opencode" | "codex"): AgentModelCatalog => ({
  runtime: runtimeKind === "opencode" ? OPENCODE_RUNTIME_DESCRIPTOR : CODEX_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: runtimeKind === "opencode" ? "GPT Five" : "GPT 5 Codex",
      variants: [],
    },
    {
      id: "proxy/sonnet",
      providerId: "proxy",
      providerName: "Anthropic Proxy",
      modelId: "sonnet",
      modelName: "Claude Sonnet",
      variants: [],
    },
  ],
  defaultModelsByProvider: {},
});

const resource = (runtimeKind: "opencode" | "codex"): ModelPickerCatalogResource => ({
  status: "ready",
  catalog: catalog(runtimeKind),
});

const favorite: AgentModelFavorite = {
  runtimeKind: "opencode",
  providerId: "proxy",
  modelId: "sonnet",
};

const runtimes = [
  {
    descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    resource: resource("opencode"),
    isEnabledForFavorites: true,
  },
  {
    descriptor: CODEX_RUNTIME_DESCRIPTOR,
    resource: resource("codex"),
    isEnabledForFavorites: true,
  },
];

describe("model-picker-model", () => {
  test("keys exact runtime, provider, and model tuples", () => {
    expect(modelPickerValueKey(favorite)).not.toBe(
      modelPickerValueKey({ ...favorite, runtimeKind: "codex" }),
    );
    expect(isSameModelPickerValue(favorite, { ...favorite })).toBe(true);
    expect(isSameModelPickerValue(favorite, { ...favorite, providerId: "anthropic" })).toBe(false);
  });

  test("puts favorites first only inside a runtime view", () => {
    const items = buildModelPickerItems({
      runtimes,
      favorites: [favorite],
      activeView: "opencode",
      searchQuery: "",
      lockedRuntimeKind: null,
    });

    expect(items.map((item) => item.value)).toEqual([
      favorite,
      { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
    ]);
  });

  test("matches every search term across runtime, provider, and model text", () => {
    const items = buildModelPickerItems({
      runtimes,
      favorites: [favorite],
      activeView: "opencode",
      searchQuery: "codex openai gpt",
      lockedRuntimeKind: null,
    });

    expect(items.map((item) => item.value)).toEqual([
      { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
    ]);
  });

  test("does not let favorite status create an unrelated search match", () => {
    expect(
      buildModelPickerItems({
        runtimes,
        favorites: [favorite],
        activeView: "favorites",
        searchQuery: "unrelated",
        lockedRuntimeKind: null,
      }),
    ).toEqual([]);
  });

  test("filters search and Favorites to the locked runtime", () => {
    const codexFavorite = { ...favorite, runtimeKind: "codex" as const };
    const searchItems = buildModelPickerItems({
      runtimes,
      favorites: [favorite, codexFavorite],
      activeView: "favorites",
      searchQuery: "sonnet",
      lockedRuntimeKind: "codex",
    });
    const favoriteItems = buildModelPickerItems({
      runtimes,
      favorites: [favorite, codexFavorite],
      activeView: "favorites",
      searchQuery: "",
      lockedRuntimeKind: "codex",
    });

    expect(searchItems.map((item) => item.value)).toEqual([codexFavorite]);
    expect(favoriteItems.map((item) => item.value)).toEqual([codexFavorite]);
  });

  test("exposes cached catalog rows from a failed refresh", () => {
    const failedRuntimes: ModelPickerRuntime[] = [
      {
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        isEnabledForFavorites: true,
        resource: {
          status: "failed",
          catalog: catalog("opencode"),
          error: "Catalog refetch failed",
          retry: async () => {},
        },
      },
    ];

    expect(
      buildModelPickerItems({
        runtimes: failedRuntimes,
        favorites: [],
        activeView: "opencode",
        searchQuery: "",
        lockedRuntimeKind: null,
      }).map((item) => item.value),
    ).toEqual([
      { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
      { runtimeKind: "opencode", providerId: "proxy", modelId: "sonnet" },
    ]);
  });

  test("keeps a cached catalog ready during a background refresh", () => {
    const retry = async () => {};
    expect(
      toModelPickerCatalogResource({
        catalog: catalog("opencode"),
        isLoading: false,
        error: null,
        isAvailable: true,
        unavailableReason: "Unavailable.",
        retry,
      }),
    ).toEqual({ status: "ready", catalog: catalog("opencode") });
    expect(
      toModelPickerCatalogResource({
        catalog: null,
        isLoading: true,
        error: null,
        isAvailable: true,
        unavailableReason: "Unavailable.",
        retry,
      }),
    ).toEqual({ status: "loading", catalog: null, retry });
  });

  test("shows the runtime reason, or the caller reason, for an unavailable catalog query", () => {
    const query = {
      runtimeKind: "opencode" as const,
      catalog: null,
      isLoading: false,
      isEnabled: true,
      error: null,
      unavailableReason: "OpenCode failed to start.",
      retry: async () => {},
    };

    expect(modelPickerResourceFromCatalogQuery(query, "Not loaded.")).toEqual({
      status: "unavailable",
      catalog: null,
      reason: "OpenCode failed to start.",
    });
    expect(
      modelPickerResourceFromCatalogQuery({ ...query, unavailableReason: null }, "Not loaded."),
    ).toEqual({ status: "unavailable", catalog: null, reason: "Not loaded." });
    expect(modelPickerResourceFromCatalogQuery(undefined, "Not loaded.")).toEqual({
      status: "unavailable",
      catalog: null,
      reason: "Not loaded.",
    });
  });
});

import { describe, expect, test } from "bun:test";
import {
  type AgentModelFavorite,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { RuntimeModelCatalogResource } from "@/state/queries/use-runtime-model-catalogs";
import {
  buildModelPickerItems,
  isSameModelPickerValue,
  modelPickerValueKey,
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

const resource = (runtimeKind: "opencode" | "codex"): RuntimeModelCatalogResource => ({
  runtimeKind,
  catalog: catalog(runtimeKind),
  isLoading: false,
  error: null,
  retry: async () => {},
});

const favorite: AgentModelFavorite = {
  runtimeKind: "opencode",
  providerId: "proxy",
  modelId: "sonnet",
};

const runtimes = [
  { descriptor: OPENCODE_RUNTIME_DESCRIPTOR, resource: resource("opencode") },
  { descriptor: CODEX_RUNTIME_DESCRIPTOR, resource: resource("codex") },
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

  test("does not expose retained catalog rows from a failed resource", () => {
    const failedRuntimes = [
      {
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        resource: { ...resource("opencode"), error: "Catalog refetch failed" },
      },
    ];

    expect(
      buildModelPickerItems({
        runtimes: failedRuntimes,
        favorites: [],
        activeView: "opencode",
        searchQuery: "",
        lockedRuntimeKind: null,
      }),
    ).toEqual([]);
  });
});

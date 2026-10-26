import { describe, expect, test } from "bun:test";
import {
  type AgentModelFavorite,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  buildModelPickerItems,
  type ModelPickerRuntime,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import {
  buildModelPickerRows,
  modelPickerTabs,
  openingModelPickerView,
  selectedModelRowIndex,
  shownModelPickerView,
} from "./model-picker-rows";

const model = (providerId: string, providerName: string, modelId: string, modelName: string) => ({
  id: `${providerId}/${modelId}`,
  providerId,
  providerName,
  modelId,
  modelName,
  variants: [],
});

const opencodeCatalog: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    model("openai", "OpenAI", "gpt-5", "GPT-5"),
    model("anthropic", "Anthropic", "sonnet", "Sonnet"),
    model("openai", "OpenAI", "gpt-5-mini", "GPT-5 Mini"),
  ],
  defaultModelsByProvider: {},
};

const codexCatalog: AgentModelCatalog = {
  runtime: CODEX_RUNTIME_DESCRIPTOR,
  models: [model("openai", "OpenAI", "gpt-5-codex", "GPT-5 Codex")],
  defaultModelsByProvider: {},
};

const runtimes: ModelPickerRuntime[] = [
  {
    descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    resource: { status: "ready", catalog: opencodeCatalog },
    isEnabledForFavorites: true,
  },
  {
    descriptor: CODEX_RUNTIME_DESCRIPTOR,
    resource: { status: "ready", catalog: codexCatalog },
    isEnabledForFavorites: true,
  },
];

const favorites: AgentModelFavorite[] = [
  { runtimeKind: "opencode", providerId: "anthropic", modelId: "sonnet" },
  { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5-codex" },
];

const rowsOf = (view: "favorites" | "opencode" | "codex", searchQuery = "") =>
  buildModelPickerRows({
    items: buildModelPickerItems({
      runtimes,
      favorites,
      activeView: view,
      searchQuery,
      lockedRuntimeKind: null,
    }),
    view,
    searching: searchQuery.length > 0,
    selectedValue: { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5-mini" },
  });

const summary = (rows: ReturnType<typeof rowsOf>) =>
  rows.map((row) => (row.type === "header" ? `# ${row.title}` : `${row.item.model.modelName}`));

describe("buildModelPickerRows", () => {
  test("a runtime lists its favorites first, then its other models by provider", () => {
    expect(summary(rowsOf("opencode"))).toEqual([
      "# Favorites",
      "Sonnet",
      "# OpenAI",
      "GPT-5",
      "GPT-5 Mini",
    ]);
  });

  test("a provider group shows the model ID, other groups add the provider", () => {
    const rows = rowsOf("opencode");
    const details = rows.flatMap((row) => (row.type === "model" ? [row.detail] : []));
    expect(details).toEqual(["Anthropic · sonnet", "gpt-5", "gpt-5-mini"]);
  });

  test("Favorites groups the favorite models by runtime with the runtime mark", () => {
    const rows = rowsOf("favorites");
    expect(summary(rows)).toEqual(["# OpenCode", "Sonnet", "# Codex", "GPT-5 Codex"]);
    expect(rows[0]?.type === "header" ? rows[0].runtimeKind : null).toBe("opencode");
  });

  test("a search lists the matches of every runtime without groups", () => {
    expect(summary(rowsOf("opencode", "codex"))).toEqual(["GPT-5 Codex"]);
  });

  test("marks the selected model and finds its row", () => {
    const rows = rowsOf("opencode");
    expect(selectedModelRowIndex(rows)).toBe(4);
    expect(selectedModelRowIndex(rowsOf("codex"))).toBeNull();
  });
});

describe("modelPickerTabs", () => {
  test("offers Favorites first when a runtime has a favorite model, then each runtime", () => {
    expect(modelPickerTabs(runtimes, favorites, null).map((tab) => tab.view)).toEqual([
      "favorites",
      "opencode",
      "codex",
    ]);
    expect(modelPickerTabs(runtimes, [], null).map((tab) => tab.view)).toEqual([
      "opencode",
      "codex",
    ]);
  });

  test("a locked runtime disables the other runtimes with the lock reason", () => {
    const tabs = modelPickerTabs(runtimes, null, {
      runtimeKind: "codex",
      reason: "An existing session cannot change its runtime.",
    });
    expect(tabs.map((tab) => tab.disabledReason)).toEqual([
      "An existing session cannot change its runtime.",
      null,
    ]);
  });
});

describe("model picker view", () => {
  const viewOf = (
    view: "favorites" | "opencode" | "codex",
    nextFavorites: AgentModelFavorite[],
    selectionRuntimeKind: "opencode" | "codex" | null,
  ) =>
    shownModelPickerView({
      view,
      tabs: modelPickerTabs(runtimes, nextFavorites, null),
      runtimes,
      favorites: nextFavorites,
      lock: null,
      selectionRuntimeKind,
    });

  test("opens on Favorites, else on the runtime of the selection", () => {
    const input = { runtimes, lock: null, selectionRuntimeKind: "codex" as const };
    expect(openingModelPickerView({ ...input, favorites })).toBe("favorites");
    expect(openingModelPickerView({ ...input, favorites: [] })).toBe("codex");
    expect(openingModelPickerView({ ...input, favorites: [], selectionRuntimeKind: null })).toBe(
      "opencode",
    );
  });

  test("shows a runtime again when the last favorite goes", () => {
    expect(viewOf("favorites", [], "codex")).toBe("codex");
    expect(viewOf("favorites", [], null)).toBe("opencode");
  });

  test("keeps the chosen view while the Favorites tab shows or a runtime is open", () => {
    expect(viewOf("favorites", favorites.slice(0, 1), "codex")).toBe("favorites");
    expect(viewOf("codex", [], "opencode")).toBe("codex");
    expect(viewOf("opencode", favorites, null)).toBe("opencode");
  });
});

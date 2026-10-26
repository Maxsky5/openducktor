import { describe, expect, test } from "bun:test";
import { CLAUDE_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ModelPickerRuntime } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import type { SpeedControlModel } from "@openducktor/frontend-core/sessions/model-selection/use-speed-control";
import {
  effortControlKind,
  effortPlaceholder,
  modelSummary,
  speedChoices,
} from "./model-field-model";

const catalog: AgentModelCatalog = {
  runtime: CLAUDE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "anthropic/opus",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "opus-4",
      modelName: "Opus 4",
      aliases: ["opus"],
      variants: [],
    },
  ],
  defaultModelsByProvider: {},
};

const runtimes: ModelPickerRuntime[] = [
  {
    descriptor: CLAUDE_RUNTIME_DESCRIPTOR,
    isEnabledForFavorites: true,
    resource: { status: "ready", catalog },
  },
];

const speed = (patch: Partial<SpeedControlModel>): SpeedControlModel => ({
  key: "k",
  choice: "standard",
  levels: [{ id: "fast", label: "Fast", description: "Uses more tokens." }],
  blockedReason: undefined,
  pending: false,
  disabled: false,
  error: null,
  onChange: () => {},
  ...patch,
});

describe("modelSummary", () => {
  test("names the catalog model of a saved alias, its runtime, and its provider", () => {
    expect(
      modelSummary(runtimes, { runtimeKind: "claude", providerId: "anthropic", modelId: "opus" }),
    ).toEqual({ runtimeKind: "claude", title: "Opus 4", detail: "Claude · Anthropic" });
  });

  test("shows the saved IDs while the catalog has no entry for the model", () => {
    expect(modelSummary(runtimes, { providerId: "openai", modelId: "gpt-5" })).toEqual({
      runtimeKind: null,
      title: "gpt-5",
      detail: "openai",
    });
  });

  test("a session selection takes the runtime of its session", () => {
    expect(
      modelSummary(runtimes, { providerId: "anthropic", modelId: "opus-4" }, "claude"),
    ).toEqual({ runtimeKind: "claude", title: "Opus 4", detail: "Claude · Anthropic" });
  });

  test("names a provider once when it has the name of its runtime", () => {
    const zen: ModelPickerRuntime = {
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      isEnabledForFavorites: true,
      resource: {
        status: "ready",
        catalog: {
          runtime: OPENCODE_RUNTIME_DESCRIPTOR,
          models: [
            {
              id: "opencode/flash",
              providerId: "opencode",
              providerName: OPENCODE_RUNTIME_DESCRIPTOR.label,
              modelId: "flash",
              modelName: "Flash",
              variants: [],
            },
          ],
          defaultModelsByProvider: {},
        },
      },
    };
    expect(
      modelSummary([zen], { runtimeKind: "opencode", providerId: "opencode", modelId: "flash" }),
    ).toEqual({
      runtimeKind: "opencode",
      title: "Flash",
      detail: OPENCODE_RUNTIME_DESCRIPTOR.label,
    });
  });

  test("has no title without a selection, so the field shows its placeholder", () => {
    expect(modelSummary(runtimes, null).title).toBeNull();
  });
});

describe("effortControlKind", () => {
  const levels = ["low", "medium", "high"].map((value) => ({ value, label: value }));

  test("shows a few levels as a track while one is chosen", () => {
    expect(effortControlKind(levels, "high")).toBe("track");
  });

  test("opens a menu for one level, many levels, or no chosen level", () => {
    expect(effortControlKind(levels, undefined)).toBe("menu");
    expect(effortControlKind(levels.slice(0, 1), "low")).toBe("menu");
    const many = ["a", "b", "c", "d", "e", "f", "g", "h"].map((value) => ({ value, label: value }));
    expect(effortControlKind(many, "a")).toBe("menu");
  });

  test("shows the placeholder when the model has no level", () => {
    expect(effortControlKind([], "high")).toBe("none");
  });

  test("shows the placeholder when the only level is the disabled effort of a live session", () => {
    const current = { value: "default", label: "default", disabled: true };
    expect(effortControlKind([current], "default")).toBe("none");
    expect(effortControlKind([current, ...levels], "default")).toBe("track");
  });
});

describe("effortPlaceholder", () => {
  test("waits for the catalog, then for a model, then says the model has no effort", () => {
    expect(effortPlaceholder({ loading: true, hasModel: true })).toBe("Loading models…");
    expect(effortPlaceholder({ loading: false, hasModel: false })).toBe("Select model first");
    expect(effortPlaceholder({ loading: false, hasModel: true })).toBe("Not supported");
  });
});

describe("speedChoices", () => {
  test("lists Standard and the model levels", () => {
    expect(speedChoices(speed({})).map((choice) => choice.label)).toEqual(["Standard", "Fast"]);
  });

  test("hides speed when the runtime or model cannot change it", () => {
    expect(speedChoices(null)).toEqual([]);
    expect(speedChoices(speed({ levels: [] }))).toEqual([]);
  });

  test("keeps Standard available while a faster level is blocked", () => {
    const choices = speedChoices(speed({ blockedReason: "Fast is not in this plan." }));
    expect(choices.map((choice) => choice.disabled)).toEqual([false, true]);
  });
});

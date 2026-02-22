import { describe, expect, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  clearRoleDefault,
  ensureAgentDefault,
  findCatalogModel,
  getMissingRequiredRoleLabels,
  selectedModelKeyForRole,
  toRoleVariantOptions,
  updateRoleDefault,
} from "./settings-modal-model";

const catalogFixture: AgentModelCatalog = {
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default", "thinking"],
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  agents: [{ name: "build", mode: "all" }],
};

const emptyDefaults = {
  spec: null,
  planner: null,
  build: null,
  qa: null,
};

describe("settings-modal-model", () => {
  test("normalizes null defaults to empty values", () => {
    expect(ensureAgentDefault(null)).toEqual({
      providerId: "",
      modelId: "",
      variant: "",
      opencodeAgent: "",
    });
  });

  test("updates and clears role defaults immutably", () => {
    const withModel = updateRoleDefault(emptyDefaults, "build", "modelId", "gpt-5");
    const withAgent = updateRoleDefault(withModel, "build", "opencodeAgent", "builder");
    const cleared = clearRoleDefault(withAgent, "build");

    expect(withModel.build?.modelId).toBe("gpt-5");
    expect(withAgent.build?.opencodeAgent).toBe("builder");
    expect(cleared.build).toBeNull();
    expect(cleared.spec).toBeNull();
  });

  test("resolves model key and variants for role", () => {
    const defaults = {
      ...emptyDefaults,
      planner: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        opencodeAgent: "planner",
      },
    };

    expect(selectedModelKeyForRole(defaults, "planner")).toBe("openai/gpt-5");
    expect(findCatalogModel(catalogFixture, "openai/gpt-5")?.modelName).toBe("GPT-5");
    expect(toRoleVariantOptions(catalogFixture, defaults, "planner")).toEqual([
      { value: "default", label: "default" },
      { value: "thinking", label: "thinking" },
    ]);
  });

  test("reports missing required role labels", () => {
    const defaults = {
      ...emptyDefaults,
      spec: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        opencodeAgent: "spec",
      },
    };

    expect(getMissingRequiredRoleLabels(defaults)).toEqual(["Planner", "Build", "QA"]);
  });
});

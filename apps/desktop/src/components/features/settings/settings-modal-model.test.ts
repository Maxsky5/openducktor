import { describe, expect, test } from "bun:test";
import type { RepoPromptOverrides } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  buildPromptOverrideValidationErrors,
  canResetPromptOverrideToBuiltin,
  clearRoleDefault,
  ensureAgentDefault,
  findCatalogModel,
  getMissingRequiredRoleLabels,
  removePromptOverride,
  resetPromptOverrideToBuiltin,
  selectedModelKeyForRole,
  togglePromptOverrideEnabled,
  toRoleVariantOptions,
  updatePromptOverrideTemplate,
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

    expect(getMissingRequiredRoleLabels(defaults)).toEqual(["Planner", "Builder", "QA"]);
  });

  test("resets prompt override only when it exists and preserves enabled flag", () => {
    const overrides: RepoPromptOverrides = {
      "kickoff.spec_initial": {
        template: "custom",
        baseVersion: 3,
        enabled: false,
      },
    };

    const unchanged = resetPromptOverrideToBuiltin(
      overrides,
      "kickoff.planner_initial",
      "builtin planner",
      4,
    );
    expect(unchanged).toBe(overrides);

    const reset = resetPromptOverrideToBuiltin(
      overrides,
      "kickoff.spec_initial",
      "builtin spec",
      5,
    );
    expect(reset["kickoff.spec_initial"]).toEqual({
      template: "builtin spec",
      baseVersion: 5,
      enabled: false,
    });
  });

  test("computes reset eligibility from override diff against builtin", () => {
    expect(canResetPromptOverrideToBuiltin(undefined, "builtin")).toBe(false);
    expect(
      canResetPromptOverrideToBuiltin(
        {
          template: "builtin\r\n",
          baseVersion: 1,
          enabled: true,
        },
        "builtin",
      ),
    ).toBe(false);
    expect(
      canResetPromptOverrideToBuiltin(
        {
          template: "custom prompt",
          baseVersion: 1,
          enabled: false,
        },
        "builtin",
      ),
    ).toBe(true);
  });

  test("removes prompt override only when entry exists", () => {
    const overrides: RepoPromptOverrides = {
      "kickoff.spec_initial": {
        template: "custom",
        baseVersion: 2,
        enabled: true,
      },
    };

    const unchanged = removePromptOverride(overrides, "kickoff.qa_review");
    expect(unchanged).toBe(overrides);

    const removed = removePromptOverride(overrides, "kickoff.spec_initial");
    expect(removed["kickoff.spec_initial"]).toBeUndefined();
  });

  test("validates unsupported placeholders in prompt overrides", () => {
    const overrides: RepoPromptOverrides = {
      "kickoff.spec_initial": {
        template: "Good {{task.id}}",
        baseVersion: 1,
        enabled: true,
      },
      "system.scenario.spec_initial": {
        template: "Bad {{task.foo}} and {{unknown.value}}",
        baseVersion: 1,
        enabled: true,
      },
    };

    expect(buildPromptOverrideValidationErrors(overrides)).toEqual({
      "system.scenario.spec_initial": "Unsupported placeholders: {{task.foo}}, {{unknown.value}}.",
    });
  });

  test("enables prompt override and creates missing entries from fallback values", () => {
    const emptyOverrides: RepoPromptOverrides = {};
    const created = togglePromptOverrideEnabled(
      emptyOverrides,
      "kickoff.spec_initial",
      true,
      "builtin",
      3,
    );
    expect(created["kickoff.spec_initial"]).toEqual({
      template: "builtin",
      baseVersion: 3,
      enabled: true,
    });

    const disabled = togglePromptOverrideEnabled(
      created,
      "kickoff.spec_initial",
      false,
      "builtin",
      3,
    );
    expect(disabled["kickoff.spec_initial"]).toEqual({
      template: "builtin",
      baseVersion: 3,
      enabled: false,
    });
  });

  test("updates prompt override template without auto-enabling entries", () => {
    const emptyOverrides: RepoPromptOverrides = {};
    const created = updatePromptOverrideTemplate(
      emptyOverrides,
      "kickoff.spec_initial",
      "custom",
      9,
    );
    expect(created["kickoff.spec_initial"]).toEqual({
      template: "custom",
      baseVersion: 9,
      enabled: false,
    });

    const enabledOverrides: RepoPromptOverrides = {
      "kickoff.spec_initial": {
        template: "old",
        baseVersion: 4,
        enabled: true,
      },
    };
    const updated = updatePromptOverrideTemplate(
      enabledOverrides,
      "kickoff.spec_initial",
      "new",
      10,
    );
    expect(updated["kickoff.spec_initial"]).toEqual({
      template: "new",
      baseVersion: 4,
      enabled: true,
    });
  });
});

import { workflowPromptSettings } from "@openducktor/frontend-core/queries/workflow-prompt-settings";
import { builtinCompiledCatalogFixture } from "@openducktor/frontend-core/test-support/workflow-fixtures";
import type { PromptSettingsLayers } from "@openducktor/workflows";
import { specPlanBuildPromptKey } from "@openducktor/workflows/test-support";
import { describe, expect, test } from "bun:test";
import {
  buildPromptLayerValidationErrors,
  inheritedPromptText,
  patchPromptAppend,
  patchPromptOverride,
  promptStatus,
  type PromptStatus,
  removePromptAppend,
  replacePrompt,
  setPromptAppendText,
} from "./settings-prompt-layers";

const templates = workflowPromptSettings(builtinCompiledCatalogFixture).templates;
const specStartKey = specPlanBuildPromptKey("messages.spec_start");
const specStart = templates.find(({ key }) => key === specStartKey)!;
const empty = (): PromptSettingsLayers => ({ overrides: {}, appends: {} });
const UNCHANGED: PromptStatus = {
  appended: false,
  overridden: false,
  outdated: false,
  error: false,
  globalChanges: false,
};

describe("prompt layer draft edits", () => {
  test("typing in an empty append turns it on and keeps the state of an append with text", () => {
    const typed = setPromptAppendText(empty(), specStartKey, "Also check docs.");
    expect(typed.appends[specStartKey]).toEqual({ text: "Also check docs.", enabled: true });

    const off = patchPromptAppend(typed, specStartKey, { enabled: false });
    expect(
      setPromptAppendText(off, specStartKey, "Also check the docs.").appends[specStartKey],
    ).toEqual({ text: "Also check the docs.", enabled: false });
    expect(removePromptAppend(off, specStartKey).appends).toEqual({});
    expect(setPromptAppendText(typed, specStartKey, "").appends).toEqual({});
  });

  test("text never creates an override", () => {
    expect(patchPromptOverride(empty(), specStartKey, { template: "Custom" })).toEqual(empty());
  });

  test("a new override starts from the inherited text and the current built-in version", () => {
    const replaced = replacePrompt(empty(), specStartKey, "Inherited", specStart.builtinVersion);
    expect(replaced.overrides[specStartKey]).toEqual({
      template: "Inherited",
      baseVersion: specStart.builtinVersion,
      enabled: true,
    });
  });

  test("keep my override reviews the override against the current built-in version", () => {
    const outdated: PromptSettingsLayers = {
      overrides: { [specStartKey]: { template: "Old", baseVersion: 1, enabled: true } },
      appends: {},
    };
    expect(promptStatus(specStart, { kind: "global", edited: outdated }, undefined)).toEqual({
      ...UNCHANGED,
      overridden: true,
      outdated: true,
    });
    const kept = patchPromptOverride(outdated, specStartKey, {
      baseVersion: specStart.builtinVersion,
    });
    expect(kept.overrides[specStartKey]).toEqual({
      template: "Old",
      baseVersion: specStart.builtinVersion,
      enabled: true,
    });
  });
});

describe("prompt status and preview", () => {
  test("the repository screen builds on the global layers", () => {
    const global: PromptSettingsLayers = {
      overrides: {
        [specStartKey]: { template: "Global base", baseVersion: specStart.builtinVersion },
      },
      appends: { [specStartKey]: { text: "Global extra", enabled: true } },
    };
    const repository: PromptSettingsLayers = {
      overrides: {},
      appends: { [specStartKey]: { text: "Repo extra", enabled: true } },
    };

    expect(
      promptStatus(
        specStart,
        { kind: "repository", edited: repository, inherited: global },
        undefined,
      ),
    ).toEqual({ ...UNCHANGED, appended: true, globalChanges: true });
    expect(
      inheritedPromptText(specStart, { kind: "repository", edited: repository, inherited: global }),
    ).toBe("Global base");
    expect(inheritedPromptText(specStart, { kind: "global", edited: empty() })).toBe(
      specStart.template,
    );
  });

  test("a prompt without changes has no state", () => {
    expect(promptStatus(specStart, { kind: "global", edited: empty() }, undefined)).toEqual(
      UNCHANGED,
    );
  });
});

describe("buildPromptLayerValidationErrors", () => {
  test("checks only layers that are on, without the placeholders that the editor lists", () => {
    const errors = buildPromptLayerValidationErrors(
      {
        overrides: {
          [specStartKey]: { template: "{{git.currentBranch}}", baseVersion: 1, enabled: false },
        },
        appends: { [specStartKey]: { text: "On {{git.currentBranch}}", enabled: true } },
      },
      templates,
    );
    expect(errors).toEqual({
      [specStartKey]: { append: `This prompt cannot fill {{git.currentBranch}}.` },
    });
  });

  test("applies required placeholders to overrides only", () => {
    const key = specPlanBuildPromptKey("messages.build_requested_changes");
    expect(
      buildPromptLayerValidationErrors(
        {
          overrides: { [key]: { template: "Review", baseVersion: 1, enabled: true } },
          appends: { [key]: { text: "Be brief.", enabled: true } },
        },
        templates,
      ),
    ).toEqual({ [key]: { override: "Missing required placeholder: {{humanFeedback}}." } });
  });
});

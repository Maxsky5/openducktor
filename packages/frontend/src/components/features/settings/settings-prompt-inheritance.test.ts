import { specPlanBuildPromptKey } from "@openducktor/workflows/test-support";
import { describe, expect, test } from "bun:test";
import { buildInheritedPromptPreview } from "./settings-prompt-inheritance";

describe("settings prompt inheritance", () => {
  test("builds inherited preview from global override and builtin", () => {
    const fromGlobal = buildInheritedPromptPreview(
      specPlanBuildPromptKey("messages.spec_start"),
      {
        template: "repo override",
        baseVersion: 2,
        enabled: false,
      },
      {
        [specPlanBuildPromptKey("messages.spec_start")]: {
          template: "global override",
          baseVersion: 1,
          enabled: true,
        },
      },
      "builtin",
    );
    expect(fromGlobal).toEqual({
      sourceLabel: "Global override",
      template: "global override",
    });

    const fromBuiltin = buildInheritedPromptPreview(
      specPlanBuildPromptKey("messages.spec_start"),
      {
        template: "repo override",
        baseVersion: 2,
        enabled: false,
      },
      {},
      "builtin prompt",
    );
    expect(fromBuiltin).toEqual({
      sourceLabel: "Builtin prompt",
      template: "builtin prompt",
    });

    const hiddenWhenRepoEnabled = buildInheritedPromptPreview(
      specPlanBuildPromptKey("messages.spec_start"),
      {
        template: "repo override",
        baseVersion: 2,
        enabled: true,
      },
      {},
      "builtin prompt",
    );
    expect(hiddenWhenRepoEnabled).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import { applySettingsModalOpenTarget } from "./settings-modal-navigation";

describe("settings modal explicit navigation", () => {
  test("reapplies the repository Scripts destination on every explicit open", () => {
    const current = {
      section: "appearance" as const,
      repositorySection: "configuration" as const,
      globalPromptRoleTab: "qa" as const,
      repoPromptRoleTab: "build" as const,
      selectedReusablePromptId: "prompt-1",
    };
    const target = {
      repositoryPath: "/repo-two",
      repositorySection: "scripts" as const,
      anchor: "dev-servers" as const,
    };

    expect(applySettingsModalOpenTarget(current, target)).toEqual({
      ...current,
      section: "repositories",
      repositorySection: "scripts",
    });
    expect(applySettingsModalOpenTarget(current, target)).toEqual(
      applySettingsModalOpenTarget(current, target),
    );
  });
});

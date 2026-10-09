import { describe, expect, test } from "bun:test";
import { resolveSettingsDeepLink } from "./settings-deep-link";

describe("resolveSettingsDeepLink", () => {
  test("opens a global settings section directly", () => {
    expect(resolveSettingsDeepLink({ kind: "global", section: "notifications" })).toEqual({
      scope: "global",
      navigation: { section: "notifications" },
    });
  });

  test("resolves the repository actions intent as one complete settings destination", () => {
    const deepLink = {
      kind: "repository-actions" as const,
      repositoryPath: "/repo-two",
    };

    expect(resolveSettingsDeepLink(deepLink)).toEqual({
      scope: "repository",
      navigation: {
        section: "repositories",
        repositorySection: "scripts",
      },
      workspaceSelectionPolicy: {
        kind: "required",
        repoPath: "/repo-two",
      },
      contentFocus: {
        kind: "repository-actions",
      },
    });
  });

  test("preserves an explicit missing repository without choosing a fallback", () => {
    expect(resolveSettingsDeepLink({ kind: "repository-actions", repositoryPath: null })).toEqual({
      scope: "repository",
      navigation: {
        section: "repositories",
        repositorySection: "scripts",
      },
      workspaceSelectionPolicy: {
        kind: "required",
        repoPath: null,
      },
      contentFocus: {
        kind: "repository-actions",
      },
    });
  });
});

import { describe, expect, test } from "bun:test";
import { resolveSettingsDeepLink } from "./settings-deep-link";

describe("resolveSettingsDeepLink", () => {
  test("resolves the repository dev-servers intent as one complete settings destination", () => {
    const deepLink = {
      kind: "repository-dev-servers" as const,
      repositoryPath: "/repo-two",
    };

    expect(resolveSettingsDeepLink(deepLink)).toEqual({
      navigation: {
        section: "repositories",
        repositorySection: "scripts",
      },
      workspaceSelectionPolicy: {
        kind: "required",
        repoPath: "/repo-two",
      },
      contentFocus: {
        kind: "repository-dev-servers",
      },
    });
  });

  test("preserves an explicit missing repository without choosing a fallback", () => {
    expect(
      resolveSettingsDeepLink({ kind: "repository-dev-servers", repositoryPath: null }),
    ).toMatchObject({
      workspaceSelectionPolicy: {
        kind: "required",
        repoPath: null,
      },
    });
  });
});

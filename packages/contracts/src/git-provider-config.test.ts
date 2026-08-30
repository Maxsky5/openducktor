import { describe, expect, test } from "bun:test";
import type { GitProviderConfig, RepoGitConfig } from "./git-schemas";
import { selectGitProviderConfig } from "./git-provider-config";

const githubConfig: GitProviderConfig = {
  id: "github",
  enabled: true,
  autoDetected: false,
  repository: {
    host: "github.com",
    owner: "open-ducktor",
    name: "desktop",
  },
};

describe("selectGitProviderConfig", () => {
  test("returns the configured provider unchanged when its id matches", () => {
    expect(selectGitProviderConfig({ provider: githubConfig }, "github")).toBe(githubConfig);
  });

  test("does not select an absent or different provider", () => {
    expect(selectGitProviderConfig({}, "github")).toBeUndefined();
    expect(
      selectGitProviderConfig(
        {
          provider: {
            id: "gitlab",
            enabled: true,
            autoDetected: false,
          },
        } satisfies RepoGitConfig,
        "github",
      ),
    ).toBeUndefined();
  });
});

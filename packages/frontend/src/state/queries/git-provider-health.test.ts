import { describe, expect, mock, test } from "bun:test";
import type { GitProviderHealth } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { gitProviderHealthQueryKeys, gitProviderHealthQueryOptions } from "./git-provider-health";

describe("git provider health query", () => {
  test("keys health by repository and loads it through the host", async () => {
    const health: GitProviderHealth = {
      providerId: "github",
      enabled: true,
      available: true,
      executablePath: "/opt/homebrew/bin/gh",
      version: "gh version 2.80.0",
      authenticated: true,
      account: "octocat",
      repositoryMappingValid: true,
    };
    const workspaceGetGitProviderHealth = mock(async () => health);
    const queryClient = new QueryClient();

    await expect(
      queryClient.fetchQuery(
        gitProviderHealthQueryOptions("/repo", { workspaceGetGitProviderHealth }),
      ),
    ).resolves.toEqual(health);
    expect(gitProviderHealthQueryKeys.repo("/repo")).toEqual(["git-provider-health", "/repo"]);
    expect(workspaceGetGitProviderHealth).toHaveBeenCalledWith("/repo");
    queryClient.clear();
  });
});

import { describe, expect, mock, test } from "bun:test";
import type { GitProviderHealth } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import {
  gitProviderHealthQueryKeys,
  gitProviderHealthQueryOptions,
  shouldLoadGitProviderHealth,
} from "./git-provider-health";

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

  test("does not load GitHub health for another provider", () => {
    expect(
      shouldLoadGitProviderHealth({
        isGitSection: true,
        provider: {
          id: "gitlab",
          enabled: true,
          autoDetected: false,
          repository: { host: "gitlab.com", owner: "acme", name: "widget" },
        },
        repoPath: "/repo",
      }),
    ).toBeFalse();
  });

  test("fails when the provider health read exceeds the diagnostics time limit", async () => {
    const hostRead = Promise.withResolvers<GitProviderHealth>();
    let runTimeout: (() => void) | undefined;
    const scheduler = (task: () => void) => {
      runTimeout = task;
      return () => {};
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const query = queryClient.fetchQuery(
      gitProviderHealthQueryOptions(
        "/repo",
        { workspaceGetGitProviderHealth: () => hostRead.promise },
        scheduler,
      ),
    );

    runTimeout?.();

    await expect(query).rejects.toThrow("Timed out after 15000ms");
    queryClient.clear();
  });
});

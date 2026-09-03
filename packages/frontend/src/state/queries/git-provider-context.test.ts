import { describe, expect, mock, test } from "bun:test";
import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type RepositoryGitProviderContext,
} from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import {
  repositoryGitProviderContextQueryKeys,
  repositoryGitProviderContextQueryOptions,
} from "./git-provider-context";

const healthyGithubContext = {
  descriptor: GITHUB_PROVIDER_DESCRIPTOR,
  config: {
    id: "github",
    enabled: true,
    autoDetected: false,
    repository: { host: "github.com", owner: "openai", name: "openducktor" },
  },
  health: {
    providerId: "github",
    enabled: true,
    available: true,
    executablePath: "/opt/homebrew/bin/gh",
    version: "gh version 2.80.0",
    authenticated: true,
    account: "octocat",
    repositoryMappingValid: true,
  },
} satisfies RepositoryGitProviderContext;

describe("repository Git provider context query", () => {
  test("keys context by repository and loads it through the host", async () => {
    const workspaceGetGitProviderContext = mock(async () => healthyGithubContext);
    const queryClient = new QueryClient();

    await expect(
      queryClient.fetchQuery(
        repositoryGitProviderContextQueryOptions("/repo", {
          workspaceGetGitProviderContext,
        }),
      ),
    ).resolves.toEqual(healthyGithubContext);
    expect(repositoryGitProviderContextQueryKeys.repo("/repo")).toEqual([
      "repository-git-provider-context",
      "/repo",
    ]);
    expect(workspaceGetGitProviderContext).toHaveBeenCalledWith("/repo");
    queryClient.clear();
  });

  test("keeps no configured provider as a cached null result", async () => {
    const queryClient = new QueryClient();

    await expect(
      queryClient.fetchQuery(
        repositoryGitProviderContextQueryOptions("/repo", {
          workspaceGetGitProviderContext: async () => null,
        }),
      ),
    ).resolves.toBeNull();
    expect(
      queryClient.getQueryData(repositoryGitProviderContextQueryKeys.repo("/repo")),
    ).toBeNull();
    queryClient.clear();
  });

  test("fails when the context read exceeds the diagnostics time limit", async () => {
    const hostRead = Promise.withResolvers<RepositoryGitProviderContext>();
    let runTimeout: (() => void) | undefined;
    const scheduler = (task: () => void) => {
      runTimeout = task;
      return () => {};
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const query = queryClient.fetchQuery(
      repositoryGitProviderContextQueryOptions(
        "/repo",
        { workspaceGetGitProviderContext: () => hostRead.promise },
        scheduler,
      ),
    );

    runTimeout?.();

    await expect(query).rejects.toThrow("Timed out after 15000ms");
    queryClient.clear();
  });
});

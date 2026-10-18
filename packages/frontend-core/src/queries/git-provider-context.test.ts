import { describe, expect, mock, test } from "bun:test";
import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import { QueryObserver, skipToken } from "@tanstack/react-query";
import { createGitProviderContextFixture } from "../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../test-support/test-client-connection";
import {
  repositoryGitProviderContextQueryKeys,
  repositoryGitProviderContextQueryOptions,
  repositoryGitProviderContextQueryOptionsOrSkip,
} from "./git-provider-context";

describe("repository Git provider context query", () => {
  test("skips the host read when no repository is active", () => {
    const context = createGitProviderContextFixture();
    const workspaceGetGitProviderContext = mock(async () => context);
    const { queryClient } = createTestClientConnection({
      client: { workspaceGetGitProviderContext },
    });
    const options = repositoryGitProviderContextQueryOptionsOrSkip(null);
    const stopObserving = new QueryObserver(queryClient, options).subscribe(() => {});
    stopObserving();

    expect(Array.from(options.queryKey)).toEqual(
      Array.from(repositoryGitProviderContextQueryKeys.repo(null)),
    );
    expect(options.queryFn).toBe(skipToken);
    expect(workspaceGetGitProviderContext).not.toHaveBeenCalled();
  });

  test("keys context by repository and loads it through the host", async () => {
    const context = createGitProviderContextFixture();
    const workspaceGetGitProviderContext = mock(async () => context);
    const { queryClient } = createTestClientConnection({
      client: { workspaceGetGitProviderContext },
    });

    await expect(
      queryClient.fetchQuery(repositoryGitProviderContextQueryOptions("/repo")),
    ).resolves.toEqual(context);
    expect(repositoryGitProviderContextQueryKeys.repo("/repo")).toEqual([
      "repository-git-provider-context",
      "/repo",
    ]);
    expect(workspaceGetGitProviderContext).toHaveBeenCalledWith("/repo");
    queryClient.clear();
  });

  test("keeps no configured provider as a cached null result", async () => {
    const { queryClient } = createTestClientConnection({
      client: { workspaceGetGitProviderContext: async () => null },
    });

    await expect(
      queryClient.fetchQuery(repositoryGitProviderContextQueryOptions("/repo")),
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
    const { queryClient } = createTestClientConnection({
      client: { workspaceGetGitProviderContext: () => hostRead.promise },
    });
    const query = queryClient.fetchQuery(
      repositoryGitProviderContextQueryOptions("/repo", scheduler),
    );

    runTimeout?.();

    await expect(query).rejects.toThrow("Timed out after 15000ms");
    queryClient.clear();
  });
});

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

const scope = { workspaceId: "workspace-1", repoPath: "/repo" };

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
      queryClient.fetchQuery(repositoryGitProviderContextQueryOptions(scope)),
    ).resolves.toEqual(context);
    expect(repositoryGitProviderContextQueryKeys.repo(scope)).toEqual([
      "repository-git-provider-context",
      scope,
    ]);
    expect(workspaceGetGitProviderContext).toHaveBeenCalledWith(scope, {
      signal: expect.any(AbortSignal),
    });
    const otherWorkspace = { ...scope, workspaceId: "workspace-2" };
    await queryClient.fetchQuery(repositoryGitProviderContextQueryOptions(otherWorkspace));
    expect(workspaceGetGitProviderContext).toHaveBeenLastCalledWith(otherWorkspace, {
      signal: expect.any(AbortSignal),
    });
    expect(workspaceGetGitProviderContext).toHaveBeenCalledTimes(2);
    queryClient.clear();
  });

  test("keeps no configured provider as a cached null result", async () => {
    const { queryClient } = createTestClientConnection({
      client: { workspaceGetGitProviderContext: async () => null },
    });

    await expect(
      queryClient.fetchQuery(repositoryGitProviderContextQueryOptions(scope)),
    ).resolves.toBeNull();
    expect(queryClient.getQueryData(repositoryGitProviderContextQueryKeys.repo(scope))).toBeNull();
    queryClient.clear();
  });

  test("cancels the context read when it exceeds the diagnostics time limit", async () => {
    const hostRead = Promise.withResolvers<RepositoryGitProviderContext>();
    let runTimeout: (() => void) | undefined;
    let readSignal: AbortSignal | undefined;
    const scheduler = (task: () => void) => {
      runTimeout = task;
      return () => {};
    };
    const { queryClient } = createTestClientConnection({
      client: {
        workspaceGetGitProviderContext: (_scope, options) => {
          readSignal = options?.signal;
          return hostRead.promise;
        },
      },
    });
    const query = queryClient
      .fetchQuery(repositoryGitProviderContextQueryOptions(scope, scheduler))
      .catch((cause: unknown) => cause);

    runTimeout?.();

    const failure = await query;
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty("message", "Timed out after 15000ms");
    expect(readSignal?.aborted).toBe(true);
    queryClient.clear();
  });
});

import "@openducktor/frontend-core/test-support/dom-environment";
import { expect, mock, test } from "bun:test";
import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type IssueItemsListInput,
  type IssueItemsListResult,
  type RepositoryGitProviderContext,
} from "@openducktor/contracts";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { repositoryGitProviderContextQueryOptions } from "@openducktor/frontend-core/queries/git-provider-context";
import { issueItemsQueryKeys } from "@openducktor/frontend-core/queries/issue-items";
import { issueImportListQueryOptions } from "@openducktor/frontend-core/tasks/issue-import/issue-import-model";
import {
  createDeferred,
  createGitProviderContextFixture,
} from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { useIssueImportReads } from "./use-issue-import-reads";

const repoPath = "/repo";
const provider = (options: Parameters<typeof createGitProviderContextFixture>[0] = {}) => ({
  ...createGitProviderContextFixture(options),
  descriptor: GITHUB_PROVIDER_DESCRIPTOR,
});
const page: IssueItemsListResult = { items: [], searchSupported: true, incompleteResults: false };

function renderReads(connection: ClientConnection) {
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(ClientConnectionProvider, { connection }, children);
  return renderHook(
    () => {
      const model = useIssueImportReads(repoPath);
      // Query tracks the fields that the sheet reads during render.
      const { data, error, isFetching, refetch } = model.query;
      return { ...model, query: { data, error, isFetching, refetch } };
    },
    { wrapper },
  );
}

function cacheProvider(connection: ClientConnection) {
  connection.queryClient.setQueryData(
    repositoryGitProviderContextQueryOptions(repoPath).queryKey,
    provider(),
  );
}

for (const cachedProvider of [false, true]) {
  test(`prepares the provider and first issue list together, cached provider=${cachedProvider}`, async () => {
    const providerRead = createDeferred<RepositoryGitProviderContext>();
    const listRead = createDeferred<IssueItemsListResult>();
    const list = mock(() => listRead.promise);
    const connection = createTestClientConnection({
      client: {
        workspaceGetGitProviderContext: () => providerRead.promise,
        issueItemsList: list,
      },
    });
    if (cachedProvider) {
      cacheProvider(connection);
    }
    const startedAt = performance.now();
    const view = renderReads(connection);
    try {
      expect(view.result.current.loading).toBe(true);
      if (!cachedProvider) {
        expect(list).not.toHaveBeenCalled();
        await act(async () => providerRead.resolve(provider()));
        await waitFor(() => expect(view.result.current.state.kind).toBe("ready"));
      }
      expect(view.result.current.loading).toBe(true);
      await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
      await act(async () => listRead.resolve(page));
      await waitFor(() => expect(view.result.current.loading).toBe(false), { timeout: 800 });
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(500);
      expect(view.result.current.query.data).toEqual(page);
    } finally {
      view.unmount();
      connection.queryClient.clear();
    }
  });
}

// The failed provider read and its retry each keep a 500 ms preparation loader.
test("a provider read failure stays actionable and retry prepares the first list", async () => {
  let providerReads = 0;
  const listRead = createDeferred<IssueItemsListResult>();
  const list = mock(() => listRead.promise);
  const connection = createTestClientConnection({
    client: {
      workspaceGetGitProviderContext: async () => {
        if (++providerReads === 1) throw new Error("Provider unavailable");
        return provider();
      },
      issueItemsList: list,
    },
  });
  const view = renderReads(connection);
  try {
    await waitFor(() => expect(view.result.current.loading).toBe(false), { timeout: 800 });
    expect(view.result.current.state).toEqual({
      kind: "read_failed",
      reason: "Could not read the Git provider. Provider unavailable",
    });
    expect(providerReads).toBe(1);
    expect(list).not.toHaveBeenCalled();

    const retryStartedAt = performance.now();
    await act(async () => {
      await view.result.current.providerQuery.refetch();
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(view.result.current.loading).toBe(true);
    await act(async () => listRead.resolve(page));
    await waitFor(() => expect(view.result.current.loading).toBe(false), { timeout: 800 });
    expect(performance.now() - retryStartedAt).toBeGreaterThanOrEqual(500);
    expect(view.result.current.query.data).toEqual(page);
  } finally {
    view.unmount();
    connection.queryClient.clear();
  }
}, 2000);

test("a first-list failure ends preparation and retry keeps the ready view", async () => {
  const retry = createDeferred<IssueItemsListResult>();
  let reads = 0;
  const connection = createTestClientConnection({
    client: {
      issueItemsList: async () => {
        if (++reads === 1) throw new Error("Issue access denied");
        return retry.promise;
      },
    },
  });
  cacheProvider(connection);
  const view = renderReads(connection);
  try {
    await waitFor(() => expect(view.result.current.loading).toBe(false), { timeout: 800 });
    expect(view.result.current.query.error?.message).toBe("Issue access denied");
    expect(reads).toBe(1);
    act(() => void view.result.current.query.refetch());
    await waitFor(() => expect(view.result.current.query.isFetching).toBe(true));
    expect(reads).toBe(2);
    expect(view.result.current.loading).toBe(false);
    await act(async () => retry.resolve(page));
    await waitFor(() => expect(view.result.current.query.data).toEqual(page));
    expect(view.result.current.loading).toBe(false);
  } finally {
    view.unmount();
    connection.queryClient.clear();
  }
});

test("ready content stays during background refresh, search, and pagination", async () => {
  const reads = [
    createDeferred<IssueItemsListResult>(),
    createDeferred<IssueItemsListResult>(),
    createDeferred<IssueItemsListResult>(),
  ];
  const requests: IssueItemsListInput[] = [];
  const connection = createTestClientConnection({
    client: {
      issueItemsList: (input) => {
        requests.push(input);
        return reads[requests.length - 1]!.promise;
      },
    },
  });
  cacheProvider(connection);
  const firstPage = { ...page, nextCursor: "page-2" };
  connection.queryClient.setQueryData(
    issueImportListQueryOptions({ repoPath, provider: provider(), search: "", cursor: undefined })
      .queryKey,
    firstPage,
  );
  const view = renderReads(connection);
  try {
    expect(view.result.current.loading).toBe(false);
    act(
      () =>
        void connection.queryClient.invalidateQueries({
          queryKey: issueItemsQueryKeys.repo(repoPath),
        }),
    );
    await waitFor(() => expect(view.result.current.query.isFetching).toBe(true));
    expect(requests).toHaveLength(1);
    expect(view.result.current.query.data).toEqual(firstPage);
    expect(view.result.current.loading).toBe(false);
    await act(async () => reads[0]!.resolve(firstPage));
    await waitFor(() => expect(view.result.current.query.isFetching).toBe(false));

    act(() => view.result.current.search.setSearchText("bug"));
    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(() => expect(view.result.current.query.isFetching).toBe(true));
    expect(requests[1]).toEqual({ repoPath, search: "bug", cursor: undefined });
    expect(view.result.current.query.data).toEqual(firstPage);
    expect(view.result.current.loading).toBe(false);
    await act(async () => reads[1]!.resolve(firstPage));
    await waitFor(() => expect(view.result.current.query.isFetching).toBe(false));

    act(() => {
      view.result.current.search.setCursors([undefined, "page-2"]);
      view.result.current.search.setPageIndex(1);
    });
    await waitFor(() => expect(requests).toHaveLength(3));
    await waitFor(() => expect(view.result.current.query.isFetching).toBe(true));
    expect(requests[2]).toEqual({ repoPath, search: "bug", cursor: "page-2" });
    expect(view.result.current.query.data).toEqual(firstPage);
    expect(view.result.current.loading).toBe(false);
    await act(async () => reads[2]!.resolve(page));
    await waitFor(() => expect(view.result.current.query.data).toEqual(page));
  } finally {
    view.unmount();
    connection.queryClient.clear();
  }
});

test.each(["missing", "unavailable"] as const)(
  "a provider with %s setup does not wait for a disabled issue list",
  (setup) => {
    const list = mock(async () => page);
    const connection = createTestClientConnection({ client: { issueItemsList: list } });
    connection.queryClient.setQueryData(
      repositoryGitProviderContextQueryOptions(repoPath).queryKey,
      provider({ enabled: setup !== "missing", available: setup !== "unavailable" }),
    );
    const view = renderReads(connection);
    try {
      expect(view.result.current.state.kind).toBe(setup === "missing" ? "setup_missing" : "ready");
      expect(view.result.current.loading).toBe(false);
      expect(list).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      connection.queryClient.clear();
    }
  },
);

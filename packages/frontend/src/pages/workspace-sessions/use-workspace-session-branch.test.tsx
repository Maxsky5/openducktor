import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { useWorkspaceSessionBranch } from "./use-workspace-session-branch";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { worktreeBranchQueryOptions } from "@/state/queries/git";

test("switching worktrees refreshes file data when both branches have the same name", async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: { gitGetCurrentBranch: async () => ({ name: "main", detached: false }) },
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const path of ["/repo/first", "/repo/second"]) {
    queryClient.setQueryData(worktreeBranchQueryOptions("/repo", path).queryKey, {
      name: "main",
      detached: false,
    });
    queryClient.setQueryData(filesystemQueryKeys.tree(path), "cached tree");
  }
  const view = renderHook(
    ({ path }) =>
      useWorkspaceSessionBranch({
        repoPath: "/repo",
        workingDirectory: path,
        isWorktree: true,
        isSwitchingBranch: false,
        activeBranch: null,
      }),
    {
      initialProps: { path: "/repo/first" },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
  try {
    await waitFor(() => expect(view.result.current.previewBranch).toBe("branch:main"));
    view.rerender({ path: "/repo/second" });
    await waitFor(() =>
      expect(
        queryClient.getQueryState(filesystemQueryKeys.tree("/repo/second"))?.isInvalidated,
      ).toBe(true),
    );
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test.each([
  { name: "repository", isWorktree: false, workingDirectory: "/repo" },
  { name: "worktree", isWorktree: true, workingDirectory: "/repo/worktree" },
])(
  "$name manual branch reads clear a failed read and recover",
  async ({ isWorktree, workingDirectory }) => {
    let name = "main";
    let fails = false;
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          gitGetCurrentBranch: async () => {
            if (fails) throw new Error("Branch read failed");
            return { name, detached: false };
          },
        },
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(
      () =>
        useWorkspaceSessionBranch({
          repoPath: "/repo",
          workingDirectory,
          isWorktree,
          isSwitchingBranch: false,
          activeBranch: { name: "main", detached: false },
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );
    try {
      await waitFor(() => expect(view.result.current.previewBranch).toBe("branch:main"));
      name = "feature";
      await act(async () => {
        expect(await view.result.current.readBranch()).toBe(
          isWorktree ? "branch:feature" : "feature",
        );
      });
      await waitFor(() => expect(view.result.current.previewBranch).toBe("branch:feature"));

      fails = true;
      await act(async () => {
        await expect(view.result.current.readBranch()).rejects.toThrow("Branch read failed");
      });
      await waitFor(() => expect(view.result.current.previewBranch).toBeNull());

      fails = false;
      name = "recovered";
      await act(async () => {
        await view.result.current.readBranch();
      });
      await waitFor(() => expect(view.result.current.previewBranch).toBe("branch:recovered"));
    } finally {
      view.unmount();
      queryClient.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

test("a worktree branch check keeps Git ready while the file preview waits", async () => {
  let holdRead = false;
  const release = Promise.withResolvers<void>();
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetCurrentBranch: async () => {
          if (holdRead) await release.promise;
          return { name: "main", detached: false };
        },
      },
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(
    () =>
      useWorkspaceSessionBranch({
        repoPath: "/repo",
        workingDirectory: "/repo/worktree",
        isWorktree: true,
        isSwitchingBranch: false,
        activeBranch: { name: "repo-root", detached: false },
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
  try {
    await waitFor(() => expect(view.result.current.previewBranch).toBe("branch:main"));
    holdRead = true;
    let pending!: Promise<string>;
    act(() => {
      pending = view.result.current.readBranch();
    });
    await waitFor(() => expect(view.result.current.previewBranch).toBeNull());
    expect(view.result.current.branchKey).toBe("branch:main");
    expect(view.result.current.branchReady).toBe(true);
    await act(async () => {
      release.resolve();
      await pending;
    });
    await waitFor(() => expect(view.result.current.previewBranch).toBe("branch:main"));
  } finally {
    release.resolve();
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

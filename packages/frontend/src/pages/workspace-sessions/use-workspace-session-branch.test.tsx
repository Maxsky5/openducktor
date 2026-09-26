import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { useWorkspaceSessionBranch } from "./use-workspace-session-branch";

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

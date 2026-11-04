import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { type GitBranch, type RepoConfig } from "@openducktor/contracts";
import { repoConfigQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createWorkspaceRecordFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { useWorkspaceRepoSettings } from "./use-workspace-repo-settings";
import { repoConfigFixture } from "@openducktor/frontend-core/test-support/repo-config-fixture";

const main: GitBranch = { name: "main", isCurrent: true, isRemote: false };

describe("useWorkspaceRepoSettings", () => {
  test("uses cached settings immediately while the current read runs", async () => {
    const refresh = Promise.withResolvers<RepoConfig>();
    const snapshot = repoConfigFixture({
      branchPrefix: "odt",
    });
    const connection = createTestClientConnection({
      client: { workspaceGetRepoConfig: async () => refresh.promise },
    });
    connection.queryClient.setQueryData(repoConfigQueryOptions("repo").queryKey, snapshot);
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(ClientConnectionProvider, { connection }, children);
    const workspace = createWorkspaceRecordFixture({ workspaceId: "repo", repoPath: "/repo" });
    const ready: boolean[] = [];
    const view = renderHook(
      () => {
        const state = useWorkspaceRepoSettings(workspace);
        ready.push(state.repoSettingsReady);
        return state;
      },
      { wrapper },
    );
    try {
      expect(view.result.current.repoSettings?.branchPrefix).toBe("odt");
      expect(ready).not.toContain(false);
      await act(async () => refresh.reject(new Error("Settings refresh failed")));
      await waitFor(() =>
        expect(view.result.current.repoSettingsRefreshError?.message).toBe(
          "Settings refresh failed",
        ),
      );
      expect(view.result.current.repoSettingsError).toBeNull();
      expect(view.result.current.repoSettings?.branchPrefix).toBe("odt");
      expect(ready).not.toContain(false);
    } finally {
      refresh.resolve(snapshot);
      view.unmount();
      await connection.dispose();
    }
  });

  test("marks settings ready as soon as the read supplies them", async () => {
    const read = Promise.withResolvers<RepoConfig>();
    const connection = createTestClientConnection({
      client: { workspaceGetRepoConfig: () => read.promise },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(ClientConnectionProvider, { connection }, children);
    const workspace = createWorkspaceRecordFixture({ workspaceId: "repo", repoPath: "/repo" });
    const view = renderHook(() => useWorkspaceRepoSettings(workspace), { wrapper });
    try {
      expect(view.result.current.repoSettingsReady).toBe(false);
      await act(async () => read.resolve(repoConfigFixture()));
      await waitFor(() => expect(view.result.current.repoSettings).not.toBeNull());
      expect(view.result.current.repoSettingsReady).toBe(true);
    } finally {
      view.unmount();
      await connection.dispose();
    }
  });

  test("reports a failed branch read and reads the branches again on retry", async () => {
    let reads = 0;
    const connection = createTestClientConnection({
      client: {
        gitGetBranches: async () => {
          reads += 1;
          if (reads === 1) throw new Error("Git is not installed.");
          return [main];
        },
      },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(ClientConnectionProvider, { connection }, children);
    const workspace = createWorkspaceRecordFixture({ repoPath: "/repo" });

    const { result } = renderHook(() => useWorkspaceRepoSettings(workspace), { wrapper });

    await waitFor(() => expect(result.current.branchesFailure).not.toBeNull());
    expect(result.current.branchesFailure?.message).toBe("Git is not installed.");
    expect(result.current.branches).toEqual([]);

    act(() => result.current.branchesFailure?.retry());

    await waitFor(() => expect(result.current.branches).toEqual([main]));
    expect(result.current.branchesFailure).toBeNull();
  });
});

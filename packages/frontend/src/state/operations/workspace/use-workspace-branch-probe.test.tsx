import { beforeEach, describe, expect, mock, test } from "bun:test";
import { CancelledError, type QueryClient, useQueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { toast } from "sonner";
import { gitQueryKeys } from "../../queries/git";
import { useWorkspaceBranchProbe } from "./use-workspace-branch-probe";
import { createBrowserListenerHarness } from "./workspace-browser-test-utils";
import { createDeferred, createWorkspaceHostClient, flush } from "./workspace-hook-test-fixtures";
import { IsolatedQueryWrapper } from "./workspace-hook-test-utils";

let workspaceHost = createWorkspaceHostClient();

beforeEach(() => {
  workspaceHost = createWorkspaceHostClient();
});

type ProbeHarnessArgs = {
  activeRepoPath: string | null;
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  setBranchSyncDegraded: (repoPath: string, value: boolean) => void;
  captureQueryClient?: (queryClient: QueryClient) => void;
};

const ProbeHarness = ({
  activeRepoPath,
  isSwitchingWorkspace,
  isLoadingBranches,
  isSwitchingBranch,
  setBranchSyncDegraded,
  captureQueryClient,
}: ProbeHarnessArgs) => {
  const queryClient = useQueryClient();

  useLayoutEffect(() => {
    captureQueryClient?.(queryClient);
  }, [captureQueryClient, queryClient]);

  useWorkspaceBranchProbe({
    activeRepoPath,
    isSwitchingWorkspace,
    isLoadingBranches,
    isSwitchingBranch,
    hostClient: workspaceHost,
    setBranchSyncDegraded,
  });

  return null;
};

describe("use-workspace-branch-probe", () => {
  test("does not refresh branches when the cached branch identity is unchanged", async () => {
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();
    const currentBranch = {
      name: "main",
      detached: false,
      revision: "abc123",
    };
    const setBranchSyncDegraded = mock((_repoPath: string, _value: boolean) => {});
    const gitGetBranches = mock(async () => []);
    const queryClientCapture: { current: QueryClient | null } = { current: null };
    workspaceHost.gitGetCurrentBranch = mock(async () => currentBranch);
    workspaceHost.gitGetBranches = gitGetBranches;

    const rendered = render(
      <ProbeHarness
        activeRepoPath="/repo-a"
        isSwitchingWorkspace={false}
        isLoadingBranches={false}
        isSwitchingBranch={false}
        setBranchSyncDegraded={setBranchSyncDegraded}
        captureQueryClient={(client) => {
          queryClientCapture.current = client;
        }}
      />,
      { wrapper: IsolatedQueryWrapper },
    );

    try {
      const queryClient = queryClientCapture.current;
      if (!queryClient) {
        throw new Error("Query client was not captured");
      }

      queryClient.setQueryData(gitQueryKeys.currentBranch("/repo-a"), currentBranch);
      await triggerFocus();

      expect(gitGetBranches).not.toHaveBeenCalled();
      expect(setBranchSyncDegraded).toHaveBeenCalledWith("/repo-a", false);
    } finally {
      rendered.unmount();
      restoreBrowserGlobals();
    }
  });

  test("does not report degradation when a branch switch cancels the current branch probe", async () => {
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();
    const currentBranchDeferred = createDeferred<{ name: string | undefined; detached: boolean }>();
    const setBranchSyncDegraded = mock((_repoPath: string, _value: boolean) => {});
    const queryClientCapture: { current: QueryClient | null } = { current: null };
    workspaceHost.gitGetCurrentBranch = mock(async () => currentBranchDeferred.promise);

    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const rendered = render(
      <ProbeHarness
        activeRepoPath="/repo-a"
        isSwitchingWorkspace={false}
        isLoadingBranches={false}
        isSwitchingBranch={false}
        setBranchSyncDegraded={setBranchSyncDegraded}
        captureQueryClient={(client) => {
          queryClientCapture.current = client;
        }}
      />,
      { wrapper: IsolatedQueryWrapper },
    );

    try {
      await triggerFocus();
      expect(workspaceHost.gitGetCurrentBranch).toHaveBeenCalledTimes(1);

      const queryClient = queryClientCapture.current;
      if (!queryClient) {
        throw new Error("Query client was not captured");
      }

      await queryClient.cancelQueries(
        { queryKey: gitQueryKeys.currentBranch("/repo-a"), exact: true },
        { silent: true },
      );
      await flush();

      expect(setBranchSyncDegraded).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      currentBranchDeferred.resolve({ name: "main", detached: false });
      rendered.unmount();
      (toast as { error: typeof toast.error }).error = originalToastError;
      restoreBrowserGlobals();
    }
  });

  test("does not report degradation when branch refresh is cancelled", async () => {
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();
    const setBranchSyncDegraded = mock((_repoPath: string, _value: boolean) => {});
    const gitGetBranches = mock(async () => {
      throw new CancelledError({ silent: true });
    });
    workspaceHost.gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    workspaceHost.gitGetBranches = gitGetBranches;

    const originalToastError = toast.error;
    const toastError = mock((_message: string, _options?: { description?: string }) => "");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const rendered = render(
      <ProbeHarness
        activeRepoPath="/repo-a"
        isSwitchingWorkspace={false}
        isLoadingBranches={false}
        isSwitchingBranch={false}
        setBranchSyncDegraded={setBranchSyncDegraded}
      />,
      { wrapper: IsolatedQueryWrapper },
    );

    try {
      await triggerFocus();

      expect(gitGetBranches).toHaveBeenCalledWith("/repo-a");
      expect(setBranchSyncDegraded).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      rendered.unmount();
      (toast as { error: typeof toast.error }).error = originalToastError;
      restoreBrowserGlobals();
    }
  });

  test("keeps listeners mounted while transient branch flags change", async () => {
    const {
      addWindowEventListener,
      removeWindowEventListener,
      addDocumentEventListener,
      removeDocumentEventListener,
      restoreBrowserGlobals,
    } = createBrowserListenerHarness();
    workspaceHost.gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    const setBranchSyncDegraded = mock((_repoPath: string, _value: boolean) => {});

    const rendered = render(
      <ProbeHarness
        activeRepoPath="/repo-a"
        isSwitchingWorkspace={false}
        isLoadingBranches={false}
        isSwitchingBranch={false}
        setBranchSyncDegraded={setBranchSyncDegraded}
      />,
      { wrapper: IsolatedQueryWrapper },
    );

    try {
      rendered.rerender(
        <ProbeHarness
          activeRepoPath="/repo-a"
          isSwitchingWorkspace={false}
          isLoadingBranches
          isSwitchingBranch={false}
          setBranchSyncDegraded={setBranchSyncDegraded}
        />,
      );
      rendered.rerender(
        <ProbeHarness
          activeRepoPath="/repo-a"
          isSwitchingWorkspace={false}
          isLoadingBranches={false}
          isSwitchingBranch
          setBranchSyncDegraded={setBranchSyncDegraded}
        />,
      );

      expect(addWindowEventListener.mock.calls.filter(([event]) => event === "focus")).toHaveLength(
        1,
      );
      expect(
        addDocumentEventListener.mock.calls.filter(([event]) => event === "visibilitychange"),
      ).toHaveLength(1);
      expect(removeWindowEventListener).not.toHaveBeenCalled();
      expect(removeDocumentEventListener).not.toHaveBeenCalled();
    } finally {
      rendered.unmount();
      restoreBrowserGlobals();
    }
  });

  test("suppresses stale degraded updates after the active repository changes", async () => {
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();
    const branchProbeDeferred = createDeferred<{ name: string | undefined; detached: boolean }>();
    const setBranchSyncDegraded = mock((_repoPath: string, _value: boolean) => {});

    workspaceHost.gitGetCurrentBranch = mock(async () => branchProbeDeferred.promise);

    const rendered = render(
      <ProbeHarness
        activeRepoPath="/repo-a"
        isSwitchingWorkspace={false}
        isLoadingBranches={false}
        isSwitchingBranch={false}
        setBranchSyncDegraded={setBranchSyncDegraded}
      />,
      { wrapper: IsolatedQueryWrapper },
    );

    try {
      await triggerFocus();
      rendered.rerender(
        <ProbeHarness
          activeRepoPath="/repo-b"
          isSwitchingWorkspace={false}
          isLoadingBranches={false}
          isSwitchingBranch={false}
          setBranchSyncDegraded={setBranchSyncDegraded}
        />,
      );

      branchProbeDeferred.reject(new Error("permission denied while reading branch"));
      await flush();

      expect(setBranchSyncDegraded).not.toHaveBeenCalledWith("/repo-b", true);
    } finally {
      rendered.unmount();
      restoreBrowserGlobals();
    }
  });

  test("uses the committed repository without letting a stale probe release its gate", async () => {
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();
    const repoAProbe = createDeferred<{ name: string | undefined; detached: boolean }>();
    const repoBProbe = createDeferred<{ name: string | undefined; detached: boolean }>();
    const setBranchSyncDegraded = mock((_repoPath: string, _value: boolean) => {});
    const gitGetCurrentBranch = mock(async (repoPath: string) => {
      if (repoPath === "/repo-a") {
        return repoAProbe.promise;
      }

      return repoBProbe.promise;
    });

    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = mock(async () => []);

    const rendered = render(
      <ProbeHarness
        activeRepoPath="/repo-a"
        isSwitchingWorkspace={false}
        isLoadingBranches={false}
        isSwitchingBranch={false}
        setBranchSyncDegraded={setBranchSyncDegraded}
      />,
      { wrapper: IsolatedQueryWrapper },
    );

    try {
      await triggerFocus();
      expect(gitGetCurrentBranch).toHaveBeenCalledTimes(1);
      expect(gitGetCurrentBranch).toHaveBeenNthCalledWith(1, "/repo-a");

      rendered.rerender(
        <ProbeHarness
          activeRepoPath="/repo-b"
          isSwitchingWorkspace={false}
          isLoadingBranches={false}
          isSwitchingBranch={false}
          setBranchSyncDegraded={setBranchSyncDegraded}
        />,
      );

      await triggerFocus();
      expect(gitGetCurrentBranch).toHaveBeenCalledTimes(2);
      expect(gitGetCurrentBranch).toHaveBeenNthCalledWith(2, "/repo-b");

      repoAProbe.resolve({
        name: "main",
        detached: false,
      });
      await flush();

      expect(setBranchSyncDegraded).not.toHaveBeenCalled();
      await triggerFocus();
      expect(gitGetCurrentBranch).toHaveBeenCalledTimes(2);

      repoBProbe.resolve({
        name: "main",
        detached: false,
      });
      await flush();

      await triggerFocus();
      expect(gitGetCurrentBranch).toHaveBeenCalledTimes(3);
    } finally {
      rendered.unmount();
      restoreBrowserGlobals();
    }
  });

  test("ignores stale synced outcomes after the repo changes during branch refresh", async () => {
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();
    const refreshDeferred = createDeferred<void>();
    const setBranchSyncDegraded = mock((_repoPath: string, _value: boolean) => {});

    workspaceHost.gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    workspaceHost.gitGetBranches = mock(async () => {
      await refreshDeferred.promise;
      return [];
    });

    const rendered = render(
      <ProbeHarness
        activeRepoPath="/repo-a"
        isSwitchingWorkspace={false}
        isLoadingBranches={false}
        isSwitchingBranch={false}
        setBranchSyncDegraded={setBranchSyncDegraded}
      />,
      { wrapper: IsolatedQueryWrapper },
    );

    try {
      await triggerFocus();
      rendered.rerender(
        <ProbeHarness
          activeRepoPath="/repo-b"
          isSwitchingWorkspace={false}
          isLoadingBranches={false}
          isSwitchingBranch={false}
          setBranchSyncDegraded={setBranchSyncDegraded}
        />,
      );

      refreshDeferred.resolve();
      await flush();

      expect(setBranchSyncDegraded).not.toHaveBeenCalled();
    } finally {
      rendered.unmount();
      restoreBrowserGlobals();
    }
  });

  test("ignores stale refresh failures after the repo changes during branch refresh", async () => {
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();
    const refreshDeferred = createDeferred<void>();
    const setBranchSyncDegraded = mock((_repoPath: string, _value: boolean) => {});

    workspaceHost.gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    workspaceHost.gitGetBranches = mock(async () => {
      await refreshDeferred.promise;
      return [];
    });

    const rendered = render(
      <ProbeHarness
        activeRepoPath="/repo-a"
        isSwitchingWorkspace={false}
        isLoadingBranches={false}
        isSwitchingBranch={false}
        setBranchSyncDegraded={setBranchSyncDegraded}
      />,
      { wrapper: IsolatedQueryWrapper },
    );

    try {
      await triggerFocus();
      rendered.rerender(
        <ProbeHarness
          activeRepoPath="/repo-b"
          isSwitchingWorkspace={false}
          isLoadingBranches={false}
          isSwitchingBranch={false}
          setBranchSyncDegraded={setBranchSyncDegraded}
        />,
      );

      refreshDeferred.reject(new Error("refresh failed"));
      await flush();

      expect(setBranchSyncDegraded).not.toHaveBeenCalled();
    } finally {
      rendered.unmount();
      restoreBrowserGlobals();
    }
  });
});

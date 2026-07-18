import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { useWorkspaceBranchProbe } from "./use-workspace-branch-probe";
import { createBrowserListenerHarness } from "./workspace-browser-test-utils";
import { createDeferred, createWorkspaceHostClient, flush } from "./workspace-hook-test-fixtures";
import { IsolatedQueryWrapper } from "./workspace-hook-test-utils";

let workspaceHost = createWorkspaceHostClient();
const noopRefreshBranchesForRepo = async (): Promise<void> => {};

beforeEach(() => {
  workspaceHost = createWorkspaceHostClient();
});

type ProbeHarnessArgs = {
  activeRepoPath: string | null;
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  setBranchSyncDegraded: (repoPath: string, value: boolean) => void;
  refreshBranchesForRepo?: (repoPath: string) => Promise<void>;
};

const ProbeHarness = ({
  activeRepoPath,
  isSwitchingWorkspace,
  isLoadingBranches,
  isSwitchingBranch,
  setBranchSyncDegraded,
  refreshBranchesForRepo = noopRefreshBranchesForRepo,
}: ProbeHarnessArgs) => {
  const currentWorkspaceRepoPathRef = useRef<string | null>(activeRepoPath);
  const lastKnownBranchNameRef = useRef<string | null>(null);
  const lastKnownDetachedRef = useRef<boolean | null>(null);
  const lastKnownRevisionRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    currentWorkspaceRepoPathRef.current = activeRepoPath;
  }, [activeRepoPath]);

  const branchProbeController = useMemo(
    () => ({
      currentWorkspaceRepoPathRef,
      lastKnownBranchNameRef,
      lastKnownDetachedRef,
      lastKnownRevisionRef,
      refreshBranchesForRepo,
    }),
    [refreshBranchesForRepo],
  );

  useWorkspaceBranchProbe({
    activeRepoPath,
    isSwitchingWorkspace,
    isLoadingBranches,
    isSwitchingBranch,
    hostClient: workspaceHost,
    branchProbeController,
    setBranchSyncDegraded,
  });

  return null;
};

describe("use-workspace-branch-probe", () => {
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

    const rendered = render(
      <ProbeHarness
        activeRepoPath="/repo-a"
        isSwitchingWorkspace={false}
        isLoadingBranches={false}
        isSwitchingBranch={false}
        setBranchSyncDegraded={setBranchSyncDegraded}
        refreshBranchesForRepo={async () => refreshDeferred.promise}
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
          refreshBranchesForRepo={async () => refreshDeferred.promise}
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

    const rendered = render(
      <ProbeHarness
        activeRepoPath="/repo-a"
        isSwitchingWorkspace={false}
        isLoadingBranches={false}
        isSwitchingBranch={false}
        setBranchSyncDegraded={setBranchSyncDegraded}
        refreshBranchesForRepo={async () => refreshDeferred.promise}
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
          refreshBranchesForRepo={async () => refreshDeferred.promise}
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

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { useMemo, useRef } from "react";
import { useWorkspaceBranchProbe } from "./use-workspace-branch-probe";
import {
  createBrowserListenerHarness,
  createDeferred,
  createWorkspaceHostClient,
  flush,
  IsolatedQueryWrapper,
} from "./workspace-operations-test-utils";

let workspaceHost = createWorkspaceHostClient();
const noopRefreshBranchesForRepo = async (): Promise<void> => {};

beforeEach(() => {
  workspaceHost = createWorkspaceHostClient();
});

afterAll(() => {
  mock.restore();
});

type ProbeHarnessArgs = {
  activeRepo: string | null;
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  setBranchSyncDegraded: (value: boolean) => void;
  refreshBranchesForRepo?: (repoPath: string) => Promise<void>;
};

const ProbeHarness = ({
  activeRepo,
  isSwitchingWorkspace,
  isLoadingBranches,
  isSwitchingBranch,
  setBranchSyncDegraded,
  refreshBranchesForRepo = noopRefreshBranchesForRepo,
}: ProbeHarnessArgs) => {
  const activeRepoRef = useRef<string | null>(activeRepo);
  const lastKnownBranchNameRef = useRef<string | null>(null);
  const lastKnownDetachedRef = useRef<boolean | null>(null);
  const lastKnownRevisionRef = useRef<string | null>(null);

  activeRepoRef.current = activeRepo;

  const branchProbeController = useMemo(
    () => ({
      activeRepoRef,
      lastKnownBranchNameRef,
      lastKnownDetachedRef,
      lastKnownRevisionRef,
      refreshBranchesForRepo,
    }),
    [refreshBranchesForRepo],
  );

  useWorkspaceBranchProbe({
    activeRepo,
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
    const setBranchSyncDegraded = mock((_value: boolean) => {});

    const rendered = render(
      <ProbeHarness
        activeRepo="/repo-a"
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
          activeRepo="/repo-a"
          isSwitchingWorkspace={false}
          isLoadingBranches
          isSwitchingBranch={false}
          setBranchSyncDegraded={setBranchSyncDegraded}
        />,
      );
      rendered.rerender(
        <ProbeHarness
          activeRepo="/repo-a"
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
    const setBranchSyncDegraded = mock((_value: boolean) => {});

    workspaceHost.gitGetCurrentBranch = mock(async () => branchProbeDeferred.promise);

    const rendered = render(
      <ProbeHarness
        activeRepo="/repo-a"
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
          activeRepo="/repo-b"
          isSwitchingWorkspace={false}
          isLoadingBranches={false}
          isSwitchingBranch={false}
          setBranchSyncDegraded={setBranchSyncDegraded}
        />,
      );

      branchProbeDeferred.reject(new Error("permission denied while reading branch"));
      await flush();

      expect(setBranchSyncDegraded).not.toHaveBeenCalledWith(true);
    } finally {
      rendered.unmount();
      restoreBrowserGlobals();
    }
  });

  test("keeps the new repo probe gate active when a stale repo probe finishes", async () => {
    const { triggerFocus, restoreBrowserGlobals } = createBrowserListenerHarness();
    const repoAProbe = createDeferred<{ name: string | undefined; detached: boolean }>();
    const repoBProbe = createDeferred<{ name: string | undefined; detached: boolean }>();
    const setBranchSyncDegraded = mock((_value: boolean) => {});
    const gitGetCurrentBranch = mock(async () => {
      const callIndex = gitGetCurrentBranch.mock.calls.length;

      if (callIndex === 1) {
        return repoAProbe.promise;
      }

      if (callIndex === 2) {
        return repoBProbe.promise;
      }

      return {
        name: "main",
        detached: false,
      };
    });

    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;

    const rendered = render(
      <ProbeHarness
        activeRepo="/repo-a"
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

      rendered.rerender(
        <ProbeHarness
          activeRepo="/repo-b"
          isSwitchingWorkspace={false}
          isLoadingBranches={false}
          isSwitchingBranch={false}
          setBranchSyncDegraded={setBranchSyncDegraded}
        />,
      );

      await triggerFocus();
      expect(gitGetCurrentBranch).toHaveBeenCalledTimes(2);

      repoAProbe.resolve({
        name: "main",
        detached: false,
      });
      await flush();

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
});

import { expect, mock, test } from "bun:test";
import type { HostClient } from "@openducktor/host-client";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  type SessionComparisonInput,
  useSessionComparison,
} from "@openducktor/frontend-core/git/use-session-comparison";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { useSessionComparisonControl } from "./use-session-comparison-control";

const initial: SessionComparisonInput = {
  enabled: true,
  viewKey: "session-1",
  repoPath: "/repo",
  workingDirectory: "/repo",
  target: { branch: "main", remote: "origin" },
  targetError: null,
  branchKey: "feature",
  checkoutIdentity: "branch:feature",
  branchReady: true,
};

test("branch list failure does not invalidate a valid comparison and retry exposes its error", async () => {
  const read = mock(async () => ({
    kind: "available" as const,
    reference: "refs/remotes/origin/main",
  }));
  const branches = mock(async (): Promise<Awaited<ReturnType<HostClient["gitGetBranches"]>>> => {
    throw new Error("Repair repository permissions.");
  });
  const connection = createTestClientConnection({
    client: { gitGetComparisonTarget: read, gitGetBranches: branches },
  });
  const client = connection.queryClient;
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
  );
  const hook = renderHook(
    () => ({
      comparison: useSessionComparison(initial),
      control: useSessionComparisonControl({
        repoPath: "/repo",
        target: initial.target,
        editable: true,
        applyTarget: async () => {},
      }),
    }),
    { wrapper },
  );
  try {
    await waitFor(() =>
      expect(hook.result.current.control.targetBranchesError).toBe(
        "Repair repository permissions.",
      ),
    );
    expect(hook.result.current.comparison.resolvedTarget).toBe("refs/remotes/origin/main");
    branches.mockResolvedValue([]);
    await act(async () => {
      await hook.result.current.control.retryTargetBranches();
    });
    await waitFor(() => expect(hook.result.current.control.targetBranchesError).toBeNull());
  } finally {
    hook.unmount();
    client.clear();
  }
});

test("updates mounted branch choices after a fetch discovers a remote branch", async () => {
  let fetched = false;
  const connection = createTestClientConnection({
    client: {
      gitGetComparisonTarget: async () => ({
        kind: "available",
        reference: "refs/remotes/origin/main",
      }),
      gitGetBranches: async () =>
        fetched ? [{ name: "origin/release", isCurrent: false, isRemote: true }] : [],
      gitFetchRemote: async () => {
        fetched = true;
        return { outcome: "fetched", output: "Fetched." };
      },
    },
  });
  const client = connection.queryClient;
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
  );
  const hook = renderHook(
    () => ({
      comparison: useSessionComparison(initial),
      control: useSessionComparisonControl({
        repoPath: initial.repoPath,
        target: initial.target,
        editable: true,
        applyTarget: async () => {},
      }),
    }),
    { wrapper },
  );
  try {
    await waitFor(() => expect(hook.result.current.control.targetBranchesPending).toBe(false));
    await act(async () => {
      await hook.result.current.comparison.refreshStep?.fetch();
    });
    await waitFor(() =>
      expect(
        hook.result.current.control.targetBranchOptions.some(
          (option) => option.value === "refs/remotes/origin/release",
        ),
      ).toBe(true),
    );
  } finally {
    hook.unmount();
    client.clear();
  }
});

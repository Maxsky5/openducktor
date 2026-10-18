import { expect, mock, test } from "bun:test";
import type { HostClient } from "@openducktor/host-client";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { useIsFetching } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  sessionComparisonOptions,
  useSessionComparison,
  useSessionComparisonControl,
  type SessionComparisonInput,
} from "./use-session-comparison";

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

test("does not restore stale comparison results after a session or target change", async () => {
  const first = Promise.withResolvers<Awaited<ReturnType<HostClient["gitGetComparisonTarget"]>>>();
  let calls = 0;
  const read = mock(async () =>
    ++calls === 1 ? first.promise : { kind: "available" as const, reference: "refs/heads/release" },
  );
  const connection = createTestClientConnection({ client: { gitGetComparisonTarget: read } });
  const client = connection.queryClient;
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
  );
  const hook = renderHook(useSessionComparison, { initialProps: initial, wrapper });
  try {
    expect(hook.result.current.resolvedTarget).toBeNull();
    hook.rerender({ ...initial, viewKey: "session-2", target: { branch: "release" } });
    await waitFor(() => expect(hook.result.current.resolvedTarget).toBe("refs/heads/release"));
    await act(async () => {
      first.resolve({ kind: "available", reference: "refs/remotes/origin/main" });
      await first.promise;
    });
    expect(hook.result.current.resolvedTarget).toBe("refs/heads/release");
    read.mockImplementation(async () => ({
      kind: "unavailable",
      reason: "Fetch origin/main or choose another branch.",
    }));
    hook.rerender(initial);
    expect(hook.result.current.resolvedTarget).toBeNull();
    await waitFor(() =>
      expect(hook.result.current.unavailableReason).toContain("Fetch origin/main"),
    );
    expect(hook.result.current.resolvedTarget).toBeNull();
  } finally {
    hook.unmount();
    client.clear();
  }
});

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

test("keeps a checked comparison during a same-context check and removes it if that check fails", async () => {
  const pending =
    Promise.withResolvers<Awaited<ReturnType<HostClient["gitGetComparisonTarget"]>>>();
  const read = mock<HostClient["gitGetComparisonTarget"]>(async () => ({
    kind: "available" as const,
    reference: "refs/remotes/origin/main",
  }));
  const connection = createTestClientConnection({ client: { gitGetComparisonTarget: read } });
  const client = connection.queryClient;
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
  );
  const hook = renderHook(
    (input: SessionComparisonInput) => ({
      comparison: useSessionComparison(input),
      fetching: useIsFetching(),
    }),
    { initialProps: initial, wrapper },
  );
  let running: Promise<boolean | null> | undefined;
  try {
    await waitFor(() =>
      expect(hook.result.current.comparison.resolvedTarget).toBe("refs/remotes/origin/main"),
    );
    read.mockImplementationOnce(() => pending.promise);
    await act(async () => {
      running = hook.result.current.comparison.refreshStep?.check().catch(() => null);
    });
    await waitFor(() => expect(hook.result.current.fetching).toBe(1));
    expect(hook.result.current.comparison.resolvedTarget).toBe("refs/remotes/origin/main");
    await act(async () => {
      pending.reject(new Error("Check repository permissions."));
      await running;
    });
    await waitFor(() => expect(hook.result.current.comparison.resolvedTarget).toBeNull());
    expect(hook.result.current.comparison.unavailableReason).toBe("Check repository permissions.");
  } finally {
    pending.resolve({ kind: "available", reference: "refs/remotes/origin/main" });
    await running;
    hook.unmount();
    client.clear();
  }
});

test("selector keeps local and remote identities plus a missing selected branch", () => {
  const options = sessionComparisonOptions(
    [
      { name: "origin/main", isCurrent: false, isRemote: false },
      { name: "origin/main", isCurrent: false, isRemote: true },
    ],
    { branch: "missing" },
    true,
  );
  expect(options.map((option) => option.value)).toEqual(
    expect.arrayContaining([
      "refs/heads/origin/main",
      "refs/remotes/origin/main",
      "refs/heads/missing",
      "@{upstream}",
    ]),
  );
});

test("the fetch step fetches the selected remote, and the check finds the moved target", async () => {
  let remoteAhead = 0;
  let fetchedAhead = 0;
  const fetch = mock(async () => {
    fetchedAhead = remoteAhead;
    return { outcome: "fetched" as const, output: "Fetched." };
  });
  const connection = createTestClientConnection({
    client: {
      gitFetchRemote: fetch,
      gitGetComparisonTarget: async () => ({
        kind: "available",
        reference: `revision-${fetchedAhead}`,
      }),
    },
  });
  const client = connection.queryClient;
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
  );
  const hook = renderHook(useSessionComparison, { initialProps: initial, wrapper });
  try {
    await waitFor(() => expect(hook.result.current.resolvedTarget).toBe("revision-0"));
    const step = hook.result.current.refreshStep;
    expect(await step?.check()).toBe(false);
    remoteAhead = 1;
    let changed: boolean | undefined;
    await act(async () => {
      await step?.fetch();
      changed = await step?.check();
    });
    expect(fetch).toHaveBeenCalledWith("/repo", "refs/remotes/origin/main", "/repo");
    expect(changed).toBe(true);
    await waitFor(() => expect(hook.result.current.resolvedTarget).toBe("revision-1"));
  } finally {
    hook.unmount();
    client.clear();
  }
});

test("reports a missing worktree without a pending comparison or host read", () => {
  const read = mock(async () => ({ kind: "available" as const, reference: "refs/heads/main" }));
  const connection = createTestClientConnection({ client: { gitGetComparisonTarget: read } });
  const client = connection.queryClient;
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
  );
  const hook = renderHook(useSessionComparison, {
    initialProps: { ...initial, workingDirectory: null },
    wrapper,
  });
  try {
    expect(hook.result.current.isPending).toBe(false);
    expect(hook.result.current.unavailableReason).toContain("Restore the session worktree");
    expect(read).not.toHaveBeenCalled();
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

test("an upstream branch switch gets its own fetch, so it does not reuse the old branch's fetch", async () => {
  const connection = createTestClientConnection({
    client: {
      gitGetComparisonTarget: async () => ({
        kind: "available",
        reference: "refs/remotes/origin/main",
      }),
    },
  });
  const client = connection.queryClient;
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
  );
  const upstream = { ...initial, target: { branch: "@{upstream}" } };
  const hook = renderHook(useSessionComparison, { initialProps: upstream, wrapper });
  try {
    await waitFor(() => expect(hook.result.current.resolvedTarget).not.toBeNull());
    const firstKey = hook.result.current.refreshStep?.fetchKey;
    hook.rerender({ ...upstream, branchKey: "other" });
    await waitFor(() => expect(hook.result.current.resolvedTarget).not.toBeNull());
    expect(hook.result.current.refreshStep?.fetchKey).not.toBe(firstKey);
  } finally {
    hook.unmount();
    client.clear();
  }
});

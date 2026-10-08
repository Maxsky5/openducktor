import { expect, mock, spyOn, test } from "bun:test";
import { QueryClientProvider, useIsFetching } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { hostClient } from "@/lib/host-client";
import { createQueryClient } from "@/lib/query-client";
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
  branchReady: true,
};

test("does not restore stale comparison results after a session or target change", async () => {
  const first =
    Promise.withResolvers<Awaited<ReturnType<typeof hostClient.gitGetComparisonTarget>>>();
  let calls = 0;
  const read = mock(async () =>
    ++calls === 1 ? first.promise : { kind: "available" as const, reference: "refs/heads/release" },
  );
  configureShellBridge(createShellBridgeFixture({ client: { gitGetComparisonTarget: read } }));
  const client = createQueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
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
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("branch list failure does not invalidate a valid comparison and retry exposes its error", async () => {
  const read = mock(async () => ({
    kind: "available" as const,
    reference: "refs/remotes/origin/main",
  }));
  const branches = mock(
    async (): Promise<Awaited<ReturnType<typeof hostClient.gitGetBranches>>> => {
      throw new Error("Repair repository permissions.");
    },
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: { gitGetComparisonTarget: read, gitGetBranches: branches },
    }),
  );
  const client = createQueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
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
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("keeps a checked comparison during a same-context refresh and removes it if that read fails", async () => {
  const pending =
    Promise.withResolvers<Awaited<ReturnType<typeof hostClient.gitGetComparisonTarget>>>();
  const read = mock<typeof hostClient.gitGetComparisonTarget>(async () => ({
    kind: "available" as const,
    reference: "refs/remotes/origin/main",
  }));
  configureShellBridge(createShellBridgeFixture({ client: { gitGetComparisonTarget: read } }));
  const client = createQueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    (input: SessionComparisonInput) => ({
      comparison: useSessionComparison(input),
      fetching: useIsFetching(),
    }),
    { initialProps: initial, wrapper },
  );
  let running: Promise<string | null> | undefined;
  try {
    await waitFor(() =>
      expect(hook.result.current.comparison.resolvedTarget).toBe("refs/remotes/origin/main"),
    );
    read.mockImplementationOnce(() => pending.promise);
    await act(async () => {
      running = hook.result.current.comparison.refreshComparison("soft").catch(() => null);
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
    configureShellBridge(createUnavailableShellBridge());
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

test("refresh fetches the selected remote on schedule and keeps the fetch cooldown", async () => {
  let now = Date.now();
  let remoteAhead = 0;
  let fetchedAhead = 0;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  const fetch = mock(async () => {
    fetchedAhead = remoteAhead;
    return { outcome: "fetched" as const, output: "Fetched." };
  });
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitFetchRemote: fetch,
        gitGetComparisonTarget: async () => ({
          kind: "available",
          reference: `revision-${fetchedAhead}`,
        }),
      },
    }),
  );
  const client = createQueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(useSessionComparison, { initialProps: initial, wrapper });
  try {
    await waitFor(() => expect(hook.result.current.resolvedTarget).toBe("revision-0"));
    remoteAhead = 1;
    await act(async () => {
      await hook.result.current.refreshComparison("scheduled");
    });
    await waitFor(() => expect(hook.result.current.resolvedTarget).toBe("revision-1"));
    expect(fetch).toHaveBeenCalledWith("/repo", "refs/remotes/origin/main", "/repo");
    remoteAhead = 2;
    now += 60_000;
    await act(async () => {
      await hook.result.current.refreshComparison("scheduled");
    });
    await act(async () => {
      await hook.result.current.refreshComparison("soft");
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(hook.result.current.resolvedTarget).toBe("revision-1"));
    now += 4 * 60_000;
    await act(async () => {
      await hook.result.current.refreshComparison("scheduled");
    });
    await waitFor(() => expect(hook.result.current.resolvedTarget).toBe("revision-2"));
    expect(fetch).toHaveBeenCalledTimes(2);
    remoteAhead = 3;
    await act(async () => {
      await hook.result.current.refreshComparison("hard");
    });
    await waitFor(() => expect(hook.result.current.resolvedTarget).toBe("revision-3"));
  } finally {
    hook.unmount();
    client.clear();
    clock.mockRestore();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("shares a pending fetch and does not recheck the old session after it completes", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof hostClient.gitFetchRemote>>>();
  const fetch = mock(() => pending.promise);
  const read = mock(
    async (_repo: string, _dir: string, target: NonNullable<SessionComparisonInput["target"]>) => ({
      kind: "available" as const,
      reference: `refs/heads/${target.branch}`,
    }),
  );
  configureShellBridge(
    createShellBridgeFixture({ client: { gitFetchRemote: fetch, gitGetComparisonTarget: read } }),
  );
  const client = createQueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(useSessionComparison, { initialProps: initial, wrapper });
  let first: Promise<string | null> | undefined;
  let second: Promise<string | null> | undefined;
  try {
    await waitFor(() => expect(hook.result.current.resolvedTarget).toBe("refs/heads/main"));
    await act(async () => {
      first = hook.result.current.refreshComparison("scheduled");
      second = hook.result.current.refreshComparison("scheduled");
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    hook.rerender({ ...initial, viewKey: "session-2", target: { branch: "release" } });
    await waitFor(() => expect(hook.result.current.resolvedTarget).toBe("refs/heads/release"));
    const calls = read.mock.calls.length;
    await act(async () => {
      pending.resolve({ outcome: "fetched", output: "Fetched." });
      expect(await first).toBeNull();
      expect(await second).toBeNull();
    });
    expect(read).toHaveBeenCalledTimes(calls);
    expect(hook.result.current.resolvedTarget).toBe("refs/heads/release");
  } finally {
    pending.resolve({ outcome: "fetched", output: "Fetched." });
    await Promise.all([first, second]);
    hook.unmount();
    client.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("reports a failed scheduled fetch and allows the next refresh to retry", async () => {
  const fetch = mock(async () => {
    throw new Error("Check the remote connection.");
  });
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitFetchRemote: fetch,
        gitGetComparisonTarget: async () => ({ kind: "available", reference: "refs/heads/main" }),
      },
    }),
  );
  const client = createQueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(useSessionComparison, { initialProps: initial, wrapper });
  try {
    await waitFor(() => expect(hook.result.current.resolvedTarget).toBe("refs/heads/main"));
    for (let attempt = 0; attempt < 2; attempt++) {
      let error: unknown;
      await act(async () => {
        try {
          await hook.result.current.refreshComparison("scheduled");
        } catch (failure) {
          error = failure;
        }
      });
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ message: "Check the remote connection." });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    hook.unmount();
    client.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

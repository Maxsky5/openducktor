import { afterEach, expect, mock, test } from "bun:test";
import type { GitLocalChanges, GitWorktreeStatus } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { toLocalChanges } from "../test-support/local-changes-fixture";
import { type GitPanelReadsInput, useGitPanelReads } from "./use-git-panel-reads";

const status = (file: string, diffScope: "target" | "uncommitted"): GitWorktreeStatus => ({
  currentBranch: { name: "feature", detached: false },
  fileStatuses: [{ path: file, status: "M", staged: false }],
  fileDiffs: [{ file, type: "modified", additions: 1, deletions: 0, diff: "" }],
  targetAheadBehind: { ahead: 1, behind: 0 },
  upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
  snapshot: {
    effectiveWorkingDir: "/repo",
    targetBranch: "origin/main",
    diffScope,
    observedAtMs: 1,
    hashVersion: 1,
    statusHash: "0123456789abcdef",
    diffHash: "fedcba9876543210",
  },
});

const input: GitPanelReadsInput = {
  repoPath: "/repo",
  workingDir: "/repo",
  comparisonReference: "origin/main",
  cacheKey: "feature",
  checkoutIdentity: "branch:feature",
  enabled: true,
};

const renderReads = (
  client: {
    gitGetLocalChanges: (repoPath: string, workingDir?: string) => Promise<GitLocalChanges>;
    gitGetWorktreeStatus?: (repoPath: string, targetBranch: string) => Promise<GitWorktreeStatus>;
  },
  initialProps: GitPanelReadsInput = input,
) => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetWorktreeStatus: async () => status("src/branch.ts", "target"),
        ...client,
      },
    }),
  );
  const queryClient = createQueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(useGitPanelReads, { initialProps, wrapper });
  return { hook, queryClient };
};

afterEach(() => configureShellBridge(createUnavailableShellBridge()));

test("reads local changes and Branch changes once the comparison is known", async () => {
  const readTarget = mock(async () => status("src/branch.ts", "target"));
  const { hook, queryClient } = renderReads(
    {
      gitGetLocalChanges: async () => toLocalChanges(status("src/local.ts", "uncommitted")),
      gitGetWorktreeStatus: readTarget,
    },
    { ...input, comparisonReference: null },
  );
  try {
    await waitFor(() => expect(hook.result.current.loadedScopesByScope.uncommitted).toBe(true));
    expect(hook.result.current.scopeStatesByScope.uncommitted.fileStatuses[0]?.path).toBe(
      "src/local.ts",
    );
    expect(hook.result.current.loadedScopesByScope.target).toBe(false);
    expect(readTarget).not.toHaveBeenCalled();

    hook.rerender(input);
    await waitFor(() => expect(hook.result.current.loadedScopesByScope.target).toBe(true));
    expect(hook.result.current.scopeStatesByScope.target.fileDiffs[0]?.file).toBe("src/branch.ts");
  } finally {
    hook.unmount();
    queryClient.clear();
  }
});

test("a failed local read rejects its refresh and shows the scope error without old files", async () => {
  let fails = false;
  const { hook, queryClient } = renderReads({
    gitGetLocalChanges: async () => {
      if (fails) throw new Error("Status read denied");
      return toLocalChanges(status("src/local.ts", "uncommitted"));
    },
  });
  try {
    await waitFor(() => expect(hook.result.current.loadedScopesByScope.uncommitted).toBe(true));
    fails = true;
    let outcome = "";
    await act(async () => {
      outcome = await hook.result.current.readLocal().then(
        () => "resolved",
        (error: Error) => error.message,
      );
    });
    expect(outcome).toBe("Status read denied");
    const local = hook.result.current.scopeStatesByScope.uncommitted;
    expect(local.error).toContain("Status read denied");
    expect(local.localChanges).toBeNull();
    expect(hook.result.current.isLoading).toBe(false);
  } finally {
    hook.unmount();
    queryClient.clear();
  }
});

test("a return to a context shows its cached result without a new read", async () => {
  const readLocal = mock(async (_repoPath: string, workingDir?: string) =>
    toLocalChanges(status(`${workingDir}/file.ts`, "uncommitted")),
  );
  const { hook, queryClient } = renderReads({ gitGetLocalChanges: readLocal });
  const other = { ...input, workingDir: "/repo/other" };
  try {
    await waitFor(() => expect(hook.result.current.loadedScopesByScope.uncommitted).toBe(true));
    hook.rerender(other);
    await waitFor(() =>
      expect(hook.result.current.scopeStatesByScope.uncommitted.fileStatuses[0]?.path).toBe(
        "/repo/other/file.ts",
      ),
    );
    const reads = readLocal.mock.calls.length;

    hook.rerender(input);

    expect(hook.result.current.scopeStatesByScope.uncommitted.fileStatuses[0]?.path).toBe(
      "/repo/file.ts",
    );
    expect(readLocal).toHaveBeenCalledTimes(reads);
  } finally {
    hook.unmount();
    queryClient.clear();
  }
});

test("a context change cancels its unfinished read, so a return reads again", async () => {
  let release!: () => void;
  const firstRead = new Promise<void>((resolve) => (release = resolve));
  let reads = 0;
  const readLocal = mock(async (_repoPath: string, workingDir?: string) => {
    reads += 1;
    if (reads === 1) await firstRead;
    return toLocalChanges(status(`${workingDir}/file.ts`, "uncommitted"));
  });
  const { hook, queryClient } = renderReads({ gitGetLocalChanges: readLocal });
  try {
    await waitFor(() => expect(readLocal).toHaveBeenCalledTimes(1));
    hook.rerender({ ...input, workingDir: "/repo/other" });
    await waitFor(() => expect(hook.result.current.loadedScopesByScope.uncommitted).toBe(true));
    release();

    hook.rerender(input);
    await waitFor(() =>
      expect(hook.result.current.scopeStatesByScope.uncommitted.fileStatuses[0]?.path).toBe(
        "/repo/file.ts",
      ),
    );
    expect(readLocal.mock.calls.filter(([, dir]) => dir === "/repo")).toHaveLength(2);
  } finally {
    release();
    hook.unmount();
    queryClient.clear();
  }
});

test("a hidden view keeps an unfinished read, and its result still arrives", async () => {
  let release!: () => void;
  const readLocal = mock(async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return toLocalChanges(status("src/late.ts", "uncommitted"));
  });
  const { hook, queryClient } = renderReads({ gitGetLocalChanges: readLocal });
  try {
    await waitFor(() => expect(readLocal).toHaveBeenCalledTimes(1));
    hook.rerender({ ...input, enabled: false });
    await act(async () => release());

    await waitFor(() =>
      expect(hook.result.current.scopeStatesByScope.uncommitted.fileStatuses[0]?.path).toBe(
        "src/late.ts",
      ),
    );
    expect(readLocal).toHaveBeenCalledTimes(1);
  } finally {
    hook.unmount();
    queryClient.clear();
  }
});

test("a change result replaces an older unfinished read and reads Branch changes again", async () => {
  let readCount = 0;
  let releaseLateRead: (() => void) | null = null;
  const readTarget = mock(async () => status("src/branch.ts", "target"));
  const { hook, queryClient } = renderReads({
    gitGetLocalChanges: async () => {
      readCount += 1;
      if (readCount === 2) {
        // This read started before the change, so its result is older than the change result.
        await new Promise<void>((resolve) => {
          releaseLateRead = resolve;
        });
        return toLocalChanges(status("src/old.ts", "uncommitted"));
      }
      return toLocalChanges(status("src/local.ts", "uncommitted"));
    },
    gitGetWorktreeStatus: readTarget,
  });
  try {
    await waitFor(() => expect(hook.result.current.loadedScopesByScope.target).toBe(true));
    let refresh: Promise<void> = Promise.resolve();
    act(() => {
      refresh = hook.result.current.readLocal();
    });
    await waitFor(() => expect(releaseLateRead).not.toBeNull());
    const targetReads = readTarget.mock.calls.length;

    await act(() =>
      hook.result.current.applyLocalChanges(
        toLocalChanges(status("src/after-change.ts", "uncommitted")),
      ),
    );
    // The cancelled read ends without a failure, so the refresh that waits on it ends too.
    await act(async () => {
      releaseLateRead?.();
      await refresh;
    });

    expect(hook.result.current.scopeStatesByScope.uncommitted.fileStatuses[0]?.path).toBe(
      "src/after-change.ts",
    );
    await waitFor(() => expect(readTarget.mock.calls.length).toBe(targetReads + 1));
    expect(hook.result.current.isLoading).toBe(false);
  } finally {
    hook.unmount();
    queryClient.clear();
  }
});

test("a rebase step keeps the shown changes until its read arrives, and another branch starts empty", async () => {
  const reads: Array<{ file: string; finish: () => void }> = [];
  const { hook, queryClient } = renderReads({
    gitGetLocalChanges: () =>
      new Promise((resolve) => {
        const file = `src/read-${reads.length + 1}.ts`;
        reads.push({ file, finish: () => resolve(toLocalChanges(status(file, "uncommitted"))) });
      }),
  });
  const shownFile = () =>
    hook.result.current.scopeStatesByScope.uncommitted.fileStatuses[0]?.path ?? null;
  try {
    await waitFor(() => expect(reads).toHaveLength(1));
    await act(async () => reads[0]?.finish());
    await waitFor(() => expect(shownFile()).toBe("src/read-1.ts"));

    // A rebase detaches HEAD, so the reads move to the keys of the detached checkout.
    hook.rerender({ ...input, cacheKey: "detached", checkoutIdentity: "detached" });
    await waitFor(() => expect(reads).toHaveLength(2));
    expect(shownFile()).toBe("src/read-1.ts");
    expect(hook.result.current.isLoading).toBe(false);
    await act(async () => reads[1]?.finish());
    await waitFor(() => expect(shownFile()).toBe("src/read-2.ts"));

    // The rebase ends on its branch, and another branch then shows no data of this one.
    hook.rerender(input);
    await act(async () => {});
    hook.rerender({ ...input, cacheKey: "other", checkoutIdentity: "branch:other" });
    await waitFor(() => expect(reads.length).toBeGreaterThanOrEqual(3));
    expect(shownFile()).toBeNull();
    expect(hook.result.current.isLoading).toBe(true);
    for (const read of reads) read.finish();
  } finally {
    hook.unmount();
    queryClient.clear();
  }
});

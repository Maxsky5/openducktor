import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { BeadsCheck, RuntimeCheck } from "@openducktor/contracts";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { RepoOpencodeHealthCheck } from "@/types/diagnostics";
import { host } from "./host";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const makeRuntimeCheck = (overrides: Partial<RuntimeCheck> = {}): RuntimeCheck => ({
  gitOk: true,
  gitVersion: "2.45.0",
  opencodeOk: true,
  opencodeVersion: "0.12.0",
  errors: [],
  ...overrides,
});

const makeBeadsCheck = (overrides: Partial<BeadsCheck> = {}): BeadsCheck => ({
  beadsOk: true,
  beadsPath: "/repo/.beads",
  beadsError: null,
  ...overrides,
});

const makeRepoHealth = (
  overrides: Partial<RepoOpencodeHealthCheck> = {},
): RepoOpencodeHealthCheck => ({
  runtimeOk: true,
  runtimeError: null,
  runtime: null,
  mcpOk: true,
  mcpError: null,
  mcpServerName: "openducktor",
  mcpServerStatus: "connected",
  mcpServerError: null,
  availableToolIds: ["odt_read_task"],
  checkedAt: "2026-02-22T08:00:00.000Z",
  errors: [],
  ...overrides,
});

const toastError = mock((_message: string, _options?: { description?: string }) => {});
let repoHealthHandler = async (_repoPath: string): Promise<RepoOpencodeHealthCheck> =>
  makeRepoHealth();
const checkRepoOpencodeHealthMock = mock((repoPath: string) => repoHealthHandler(repoPath));

mock.module("sonner", () => ({
  toast: {
    error: (message: string, options?: { description?: string }) => toastError(message, options),
  },
}));

mock.module("./opencode-catalog", () => ({
  checkRepoOpencodeHealth: (repoPath: string) => checkRepoOpencodeHealthMock(repoPath),
}));

type UseChecksHook = typeof import("./use-checks")["useChecks"];
type HookArgs = Parameters<UseChecksHook>[0];
type HookResult = ReturnType<UseChecksHook>;

let useChecks: UseChecksHook;

const createHookHarness = (initialArgs: HookArgs) => {
  let latest: HookResult | null = null;
  let currentArgs = initialArgs;

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useChecks(args);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  return {
    mount: async () => {
      await act(async () => {
        renderer = TestRenderer.create(createElement(Harness, { args: currentArgs }));
      });
      await flush();
    },
    updateArgs: async (nextArgs: HookArgs) => {
      currentArgs = nextArgs;
      await act(async () => {
        renderer?.update(createElement(Harness, { args: currentArgs }));
      });
      await flush();
    },
    run: async (fn: (value: HookResult) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      await act(async () => {
        await fn(latest as HookResult);
      });
      await flush();
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    unmount: async () => {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = null;
    },
  };
};

beforeAll(async () => {
  ({ useChecks } = await import("./use-checks"));
});

beforeEach(() => {
  toastError.mockClear();
  checkRepoOpencodeHealthMock.mockClear();
  repoHealthHandler = async () => makeRepoHealth();
});

describe("use-checks", () => {
  test("refreshChecks is a no-op when no active repo is selected", async () => {
    const runtimeCheck = mock(async (): Promise<RuntimeCheck> => makeRuntimeCheck());
    const beadsCheck = mock(async (): Promise<BeadsCheck> => makeBeadsCheck());

    const original = {
      runtimeCheck: host.runtimeCheck,
      beadsCheck: host.beadsCheck,
    };
    host.runtimeCheck = runtimeCheck;
    host.beadsCheck = beadsCheck;

    const harness = createHookHarness({ activeRepo: null });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(runtimeCheck).not.toHaveBeenCalled();
      expect(beadsCheck).not.toHaveBeenCalled();
      expect(checkRepoOpencodeHealthMock).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
      expect(harness.getLatest().isLoadingChecks).toBe(false);
    } finally {
      await harness.unmount();
      host.runtimeCheck = original.runtimeCheck;
      host.beadsCheck = original.beadsCheck;
    }
  });

  test("refreshRuntimeCheck caches and supports force retries", async () => {
    const runtimeCheck = mock(async (): Promise<RuntimeCheck> => makeRuntimeCheck());

    const original = {
      runtimeCheck: host.runtimeCheck,
    };
    host.runtimeCheck = runtimeCheck;

    const harness = createHookHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshRuntimeCheck();
        await value.refreshRuntimeCheck();
        await value.refreshRuntimeCheck(true);
      });

      expect(runtimeCheck).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().hasRuntimeCheck()).toBe(true);
    } finally {
      await harness.unmount();
      host.runtimeCheck = original.runtimeCheck;
    }
  });

  test("tracks per-repo cache and projects cached checks when active repo changes", async () => {
    const beadsCheck = mock(
      async (repoPath: string): Promise<BeadsCheck> =>
        makeBeadsCheck({ beadsPath: `${repoPath}/.beads` }),
    );
    repoHealthHandler = async (repoPath: string) =>
      makeRepoHealth({ checkedAt: `${repoPath}-checked`, availableToolIds: [repoPath] });

    const original = {
      beadsCheck: host.beadsCheck,
    };
    host.beadsCheck = beadsCheck;

    const harness = createHookHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBeadsCheckForRepo("/repo-b");
        await value.refreshRepoOpencodeHealthForRepo("/repo-b");
      });

      expect(harness.getLatest().activeBeadsCheck).toBeNull();
      expect(harness.getLatest().activeRepoOpencodeHealth).toBeNull();
      expect(harness.getLatest().hasCachedBeadsCheck("/repo-b")).toBe(true);
      expect(harness.getLatest().hasCachedRepoOpencodeHealth("/repo-b")).toBe(true);

      await harness.updateArgs({ activeRepo: "/repo-b" });
      expect(harness.getLatest().activeBeadsCheck?.beadsPath).toBe("/repo-b/.beads");
      expect(harness.getLatest().activeRepoOpencodeHealth?.availableToolIds).toEqual(["/repo-b"]);

      await harness.run(async (value) => {
        await value.refreshBeadsCheckForRepo("/repo-b");
        await value.refreshRepoOpencodeHealthForRepo("/repo-b");
      });

      expect(beadsCheck).toHaveBeenCalledTimes(1);
      expect(checkRepoOpencodeHealthMock).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      host.beadsCheck = original.beadsCheck;
    }
  });

  test("refreshChecks reports unhealthy diagnostics details", async () => {
    const runtimeCheck = mock(
      async (): Promise<RuntimeCheck> =>
        makeRuntimeCheck({ gitOk: false, errors: ["git unavailable"] }),
    );
    const beadsCheck = mock(
      async (): Promise<BeadsCheck> =>
        makeBeadsCheck({ beadsOk: false, beadsError: "missing .beads" }),
    );
    repoHealthHandler = async () =>
      makeRepoHealth({ mcpOk: false, mcpError: "mcp offline", errors: ["mcp offline"] });

    const original = {
      runtimeCheck: host.runtimeCheck,
      beadsCheck: host.beadsCheck,
    };
    host.runtimeCheck = runtimeCheck;
    host.beadsCheck = beadsCheck;

    const harness = createHookHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(toastError).toHaveBeenCalledWith("Diagnostics check failed", {
        description: "git unavailable | beads: missing .beads | mcp offline",
      });
      expect(harness.getLatest().isLoadingChecks).toBe(false);
    } finally {
      await harness.unmount();
      host.runtimeCheck = original.runtimeCheck;
      host.beadsCheck = original.beadsCheck;
    }
  });

  test("refreshChecks forces a fresh runtime check and surfaces errors", async () => {
    let callCount = 0;
    const runtimeCheck = mock(
      async (): Promise<RuntimeCheck> =>
        new Promise((resolve, reject) => {
          callCount += 1;
          if (callCount === 1) {
            resolve(makeRuntimeCheck());
            return;
          }
          reject(new Error("runtime down"));
        }),
    );

    const original = {
      runtimeCheck: host.runtimeCheck,
    };
    host.runtimeCheck = runtimeCheck;

    const harness = createHookHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshRuntimeCheck();
      });
      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(runtimeCheck).toHaveBeenCalledTimes(2);
      expect(toastError).toHaveBeenCalledWith("Diagnostics check unavailable", {
        description: "runtime down",
      });
      expect(harness.getLatest().isLoadingChecks).toBe(false);
    } finally {
      await harness.unmount();
      host.runtimeCheck = original.runtimeCheck;
    }
  });
});

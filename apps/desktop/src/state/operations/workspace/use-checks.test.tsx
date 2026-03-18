import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type BeadsCheck,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeCheck,
  type RuntimeKind,
} from "@openducktor/contracts";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { clearAppQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { host } from "../shared/host";

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
  ghOk: true,
  ghVersion: "2.73.0",
  ghAuthOk: true,
  ghAuthLogin: "octocat",
  ghAuthError: null,
  runtimes: [{ kind: "opencode", ok: true, version: "0.12.0" }],
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
  overrides: Partial<RepoRuntimeHealthCheck> = {},
): RepoRuntimeHealthCheck => ({
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
const toastSuccess = mock((_message: string, _options?: { description?: string }) => {});
let repoHealthHandler = async (
  _repoPath: string,
  _runtimeKind: RuntimeKind,
): Promise<RepoRuntimeHealthCheck> => makeRepoHealth();
const checkRepoRuntimeHealthMock = mock((repoPath: string, runtimeKind: RuntimeKind) =>
  repoHealthHandler(repoPath, runtimeKind),
);

mock.module("sonner", () => ({
  toast: {
    error: (message: string, options?: { description?: string }) => toastError(message, options),
    success: (message: string, options?: { description?: string }) =>
      toastSuccess(message, options),
  },
}));

type UseChecksHook = typeof import("./use-checks")["useChecks"];
type HookArgs = Parameters<UseChecksHook>[0];
type HookResult = ReturnType<UseChecksHook>;
type HookHarnessArgs = Omit<HookArgs, "checkRepoRuntimeHealth"> & {
  checkRepoRuntimeHealth?: HookArgs["checkRepoRuntimeHealth"];
};

let useChecks: UseChecksHook;

const createHookHarness = (initialArgs: HookHarnessArgs) => {
  let latest: HookResult | null = null;
  let currentArgs: HookArgs = {
    ...initialArgs,
    checkRepoRuntimeHealth:
      initialArgs.checkRepoRuntimeHealth ??
      ((repoPath: string, runtimeKind: RuntimeKind) =>
        checkRepoRuntimeHealthMock(repoPath, runtimeKind)),
  };

  const Harness = ({ args }: { args: HookArgs }) => {
    latest = useChecks(args);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  return {
    mount: async () => {
      await act(async () => {
        renderer = TestRenderer.create(
          createElement(
            QueryProvider,
            { useIsolatedClient: true },
            createElement(Harness, { args: currentArgs }),
          ),
        );
      });
      await flush();
    },
    updateArgs: async (nextArgs: Partial<HookHarnessArgs>) => {
      currentArgs = {
        ...currentArgs,
        ...nextArgs,
        checkRepoRuntimeHealth:
          nextArgs.checkRepoRuntimeHealth ?? currentArgs.checkRepoRuntimeHealth,
      };
      await act(async () => {
        renderer?.update(
          createElement(
            QueryProvider,
            { useIsolatedClient: true },
            createElement(Harness, { args: currentArgs }),
          ),
        );
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

beforeEach(async () => {
  await clearAppQueryClient();
  toastError.mockClear();
  toastSuccess.mockClear();
  checkRepoRuntimeHealthMock.mockClear();
  repoHealthHandler = async () => makeRepoHealth();
});

describe("use-checks", () => {
  test("refreshChecks is a no-op when no active repo is selected", async () => {
    const runtimeCheck = mock(
      async (_force?: boolean): Promise<RuntimeCheck> => makeRuntimeCheck(),
    );
    const beadsCheck = mock(async (): Promise<BeadsCheck> => makeBeadsCheck());

    const original = {
      runtimeCheck: host.runtimeCheck,
      beadsCheck: host.beadsCheck,
    };
    host.runtimeCheck = runtimeCheck;
    host.beadsCheck = beadsCheck;

    const harness = createHookHarness({
      activeRepo: null,
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(runtimeCheck).not.toHaveBeenCalled();
      expect(beadsCheck).not.toHaveBeenCalled();
      expect(checkRepoRuntimeHealthMock).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
      expect(harness.getLatest().isLoadingChecks).toBe(false);
    } finally {
      await harness.unmount();
      host.runtimeCheck = original.runtimeCheck;
      host.beadsCheck = original.beadsCheck;
    }
  });

  test("refreshRuntimeCheck caches and supports force retries", async () => {
    const runtimeCheck = mock(
      async (_force?: boolean): Promise<RuntimeCheck> => makeRuntimeCheck(),
    );

    const original = {
      runtimeCheck: host.runtimeCheck,
    };
    host.runtimeCheck = runtimeCheck;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshRuntimeCheck();
        await value.refreshRuntimeCheck();
        await value.refreshRuntimeCheck(true);
      });

      expect(runtimeCheck).toHaveBeenCalledTimes(2);
      expect(runtimeCheck.mock.calls[0]).toEqual([false]);
      expect(runtimeCheck.mock.calls[1]).toEqual([true]);
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

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBeadsCheckForRepo("/repo-b");
        await value.refreshRepoRuntimeHealthForRepo("/repo-b");
      });

      expect(harness.getLatest().activeBeadsCheck).toBeNull();
      expect(harness.getLatest().activeRepoRuntimeHealthByRuntime.opencode).toBeNull();
      expect(harness.getLatest().hasCachedBeadsCheck("/repo-b")).toBe(true);
      expect(harness.getLatest().hasCachedRepoRuntimeHealth("/repo-b", ["opencode"])).toBe(true);

      await harness.updateArgs({ activeRepo: "/repo-b" });
      expect(harness.getLatest().activeBeadsCheck?.beadsPath).toBe("/repo-b/.beads");
      expect(
        harness.getLatest().activeRepoRuntimeHealthByRuntime.opencode?.availableToolIds,
      ).toEqual(["/repo-b"]);

      await harness.run(async (value) => {
        await value.refreshBeadsCheckForRepo("/repo-b");
        await value.refreshRepoRuntimeHealthForRepo("/repo-b");
      });

      expect(beadsCheck).toHaveBeenCalledTimes(1);
      expect(checkRepoRuntimeHealthMock).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      host.beadsCheck = original.beadsCheck;
    }
  });

  test("refreshChecks reports unhealthy diagnostics details", async () => {
    const runtimeCheck = mock(
      async (_force?: boolean): Promise<RuntimeCheck> =>
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

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

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
      async (_force?: boolean): Promise<RuntimeCheck> =>
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

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshRuntimeCheck();
      });
      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(runtimeCheck).toHaveBeenCalledTimes(2);
      expect(runtimeCheck.mock.calls[0]).toEqual([false]);
      expect(runtimeCheck.mock.calls[1]).toEqual([true]);
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

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type BeadsCheck,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeCheck,
  type RuntimeDescriptor,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { clearAppQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { host } from "../shared/host";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const HOST_METHOD_NAMES = ["runtimeCheck", "beadsCheck"] as const;
type HostMethodName = (typeof HOST_METHOD_NAMES)[number];
type HostMethodMap = Pick<typeof host, HostMethodName>;
const originalHostMethods = Object.fromEntries(
  HOST_METHOD_NAMES.map((name) => [name, host[name]]),
) as HostMethodMap;

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

const MOCK_RUNTIME_DESCRIPTOR: RuntimeDescriptor = {
  kind: "mock-runtime",
  label: "Mock Runtime",
  description: "Mock runtime descriptor for per-kind health tests.",
  readOnlyRoleBlockedTools: [],
  capabilities: {
    ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
  },
};

const toastError = mock((_message: string, _options?: { description?: string }) => {});
const toastSuccess = mock((_message: string, _options?: { description?: string }) => {});
let repoHealthHandler = async (
  _repoPath: string,
  _runtimeKind: RuntimeKind,
): Promise<RepoRuntimeHealthCheck> => makeRepoHealth();
const checkRepoRuntimeHealthMock = mock((repoPath: string, runtimeKind: RuntimeKind) =>
  repoHealthHandler(repoPath, runtimeKind),
);

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

  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <QueryProvider useIsolatedClient>{children}</QueryProvider>
  );

  const sharedHarness = createSharedHookHarness(Harness, { args: currentArgs }, { wrapper });

  return {
    mount: async () => {
      await sharedHarness.mount();
    },
    updateArgs: async (nextArgs: Partial<HookHarnessArgs>) => {
      currentArgs = {
        ...currentArgs,
        ...nextArgs,
        checkRepoRuntimeHealth:
          nextArgs.checkRepoRuntimeHealth ?? currentArgs.checkRepoRuntimeHealth,
      };
      await sharedHarness.update({ args: currentArgs });
    },
    run: async (fn: (value: HookResult) => Promise<void> | void) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      await sharedHarness.run(async () => {
        await fn(latest as HookResult);
      });
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }
      return latest;
    },
    waitFor: async (predicate: (value: HookResult) => boolean, timeoutMs?: number) => {
      await sharedHarness.waitFor(() => latest !== null && predicate(latest), timeoutMs);
    },
    unmount: async () => {
      try {
        await sharedHarness.unmount();
      } finally {
        latest = null;
      }
    },
  };
};

beforeAll(async () => {
  mock.module("sonner", () => ({
    toast: {
      error: (message: string, options?: { description?: string }) => toastError(message, options),
      success: (message: string, options?: { description?: string }) =>
        toastSuccess(message, options),
    },
  }));
  ({ useChecks } = await import("./use-checks"));
});

beforeEach(async () => {
  Object.assign(host, originalHostMethods);
  await clearAppQueryClient();
  toastError.mockClear();
  toastSuccess.mockClear();
  checkRepoRuntimeHealthMock.mockClear();
  repoHealthHandler = async () => makeRepoHealth();
});

afterAll(() => {
  Object.assign(host, originalHostMethods);
  mock.restore();
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
      runtimeCheck.mockClear();
      beadsCheck.mockClear();
      checkRepoRuntimeHealthMock.mockClear();
      await harness.run(async (value) => {
        await value.refreshChecks();
      });
      await harness.waitFor((value) => value.isLoadingChecks === false);

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
      runtimeCheck.mockClear();
      await harness.run(async (value) => {
        await value.refreshRuntimeCheck();
        await value.refreshRuntimeCheck();
        await value.refreshRuntimeCheck(true);
      });

      expect(runtimeCheck).toHaveBeenCalledTimes(1);
      expect(runtimeCheck.mock.calls[0]).toEqual([true]);
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
      await harness.waitFor((value) => value.activeBeadsCheck?.beadsPath === "/repo-a/.beads");
      beadsCheck.mockClear();
      checkRepoRuntimeHealthMock.mockClear();
      await harness.run(async (value) => {
        await value.refreshBeadsCheckForRepo("/repo-b");
        await value.refreshRepoRuntimeHealthForRepo("/repo-b");
      });
      await harness.waitFor((value) => value.hasCachedBeadsCheck("/repo-b"));
      await harness.waitFor((value) => value.hasCachedRepoRuntimeHealth("/repo-b", ["opencode"]));

      expect(harness.getLatest().activeBeadsCheck?.beadsPath).toBe("/repo-a/.beads");
      expect(
        harness.getLatest().activeRepoRuntimeHealthByRuntime.opencode?.availableToolIds,
      ).toEqual(["/repo-a"]);
      expect(harness.getLatest().hasCachedBeadsCheck("/repo-b")).toBe(true);
      expect(harness.getLatest().hasCachedRepoRuntimeHealth("/repo-b", ["opencode"])).toBe(true);
      expect(beadsCheck).toHaveBeenCalledTimes(1);
      expect(checkRepoRuntimeHealthMock).toHaveBeenCalledTimes(1);

      await harness.updateArgs({ activeRepo: "/repo-b" });
      expect(harness.getLatest().activeBeadsCheck?.beadsPath).toBe("/repo-b/.beads");
      expect(
        harness.getLatest().activeRepoRuntimeHealthByRuntime.opencode?.availableToolIds,
      ).toEqual(["/repo-b"]);

      beadsCheck.mockClear();
      checkRepoRuntimeHealthMock.mockClear();
      await harness.run(async (value) => {
        await value.refreshBeadsCheckForRepo("/repo-b");
        await value.refreshRepoRuntimeHealthForRepo("/repo-b");
      });

      expect(beadsCheck).not.toHaveBeenCalled();
      expect(checkRepoRuntimeHealthMock).not.toHaveBeenCalled();
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

  test("projects runtime health query failures as unhealthy runtime state", async () => {
    repoHealthHandler = async () => {
      throw new Error("runtime health unreachable");
    };

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();

      await harness.run(async (value) => {
        await expect(value.refreshRepoRuntimeHealthForRepo("/repo-a", true)).resolves.toBeDefined();
      });

      await harness.waitFor((value) => {
        const runtimeHealth = value.activeRepoRuntimeHealthByRuntime.opencode;
        return runtimeHealth != null && runtimeHealth.runtimeOk === false;
      });

      expect(harness.getLatest().activeRepoRuntimeHealthByRuntime.opencode).toEqual(
        expect.objectContaining({
          runtimeOk: false,
          mcpOk: false,
          runtimeError: "runtime health unreachable",
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("prefers runtime health query error state over stale successful data", async () => {
    let shouldFailRefresh = false;
    repoHealthHandler = async () => {
      if (shouldFailRefresh) {
        throw new Error("runtime health refresh failed");
      }
      return makeRepoHealth({ availableToolIds: ["healthy"] });
    };

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => {
        return value.activeRepoRuntimeHealthByRuntime.opencode?.runtimeOk === true;
      });

      shouldFailRefresh = true;

      await harness.run(async (value) => {
        await expect(value.refreshRepoRuntimeHealthForRepo("/repo-a", true)).resolves.toBeDefined();
      });

      await harness.waitFor((value) => {
        const runtimeHealth = value.activeRepoRuntimeHealthByRuntime.opencode;
        return runtimeHealth != null && runtimeHealth.runtimeOk === false;
      });

      expect(harness.getLatest().activeRepoRuntimeHealthByRuntime.opencode).toEqual(
        expect.objectContaining({
          runtimeOk: false,
          mcpOk: false,
          runtimeError: "runtime health refresh failed",
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("keeps healthy runtime kinds when one runtime health probe fails", async () => {
    repoHealthHandler = async (_repoPath, runtimeKind) => {
      if (runtimeKind === "mock-runtime") {
        throw new Error("mock runtime probe failed");
      }
      return makeRepoHealth({ availableToolIds: [runtimeKind] });
    };

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, MOCK_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();

      await harness.run(async (value) => {
        await expect(value.refreshRepoRuntimeHealthForRepo("/repo-a", true)).resolves.toBeDefined();
      });

      await harness.waitFor((value) => {
        const opencodeHealth = value.activeRepoRuntimeHealthByRuntime.opencode;
        const mockRuntimeHealth = value.activeRepoRuntimeHealthByRuntime["mock-runtime"];
        return opencodeHealth != null && mockRuntimeHealth != null;
      });

      expect(harness.getLatest().activeRepoRuntimeHealthByRuntime.opencode).toEqual(
        expect.objectContaining({
          runtimeOk: true,
          availableToolIds: ["opencode"],
        }),
      );
      expect(harness.getLatest().activeRepoRuntimeHealthByRuntime["mock-runtime"]).toEqual(
        expect.objectContaining({
          runtimeOk: false,
          mcpOk: false,
          runtimeError: "mock runtime probe failed",
        }),
      );
    } finally {
      await harness.unmount();
    }
  });
});

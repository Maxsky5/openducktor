import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type BeadsCheck,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeCheck,
  type RuntimeDescriptor,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  type BeadsCheckFixtureOverrides,
  createBeadsCheckFixture,
  createDeferred,
} from "@/test-utils/shared-test-fixtures";
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

const makeBeadsCheck = (overrides: BeadsCheckFixtureOverrides = {}): BeadsCheck =>
  createBeadsCheckFixture({}, overrides);

type RepoHealthOverrides = Omit<Partial<RepoRuntimeHealthCheck>, "runtime" | "mcp"> & {
  runtime?: Partial<RepoRuntimeHealthCheck["runtime"]>;
  mcp?: Partial<NonNullable<RepoRuntimeHealthCheck["mcp"]>>;
};

const makeRepoHealth = (overrides: RepoHealthOverrides = {}): RepoRuntimeHealthCheck => {
  const checkedAt = overrides.checkedAt ?? "2026-02-22T08:00:00.000Z";
  const runtime: RepoRuntimeHealthCheck["runtime"] = {
    status: "ready",
    stage: "runtime_ready",
    observation: null,
    instance: null,
    startedAt: null,
    updatedAt: checkedAt,
    elapsedMs: null,
    attempts: null,
    detail: null,
    failureKind: null,
    failureReason: null,
    ...overrides.runtime,
  };
  const mcp: NonNullable<RepoRuntimeHealthCheck["mcp"]> = {
    supported: true,
    status: "connected",
    serverName: "openducktor",
    serverStatus: "connected",
    toolIds: ["odt_read_task"],
    detail: null,
    failureKind: null,
    ...overrides.mcp,
  };

  return {
    status:
      overrides.status ??
      (runtime.status === "error" || mcp.status === "error"
        ? "error"
        : mcp.status === "checking" ||
            mcp.status === "reconnecting" ||
            mcp.status === "waiting_for_runtime"
          ? "checking"
          : runtime.status),
    checkedAt,
    runtime,
    mcp,
  };
};

const MOCK_RUNTIME_DESCRIPTOR: RuntimeDescriptor = {
  kind: "mock-runtime",
  label: "Mock Runtime",
  description: "Mock runtime descriptor for per-kind health tests.",
  readOnlyRoleBlockedTools: [],
  capabilities: {
    ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
  },
};

const toastMessage = mock(
  (_message: string, _options?: { description?: string; id?: string; duration?: number }) => {},
);
const toastError = mock(
  (_message: string, _options?: { description?: string; id?: string; duration?: number }) => {},
);
const toastDismiss = mock((_toastId?: string | number) => {});
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

type HookHarness = ReturnType<typeof createHookHarness>;

const captureDeferredRejection = <T,>(promise: Promise<T>): Promise<T> => {
  void promise.catch(() => {});
  return promise;
};

const waitForInitialChecksToSettle = async (
  harness: HookHarness,
  runtimeKinds: RuntimeKind[] = ["opencode"],
) => {
  await harness.mount();
  await harness.waitFor((value) => {
    return (
      value.runtimeCheck !== null &&
      value.activeBeadsCheck !== null &&
      runtimeKinds.every(
        (runtimeKind) => value.activeRepoRuntimeHealthByRuntime[runtimeKind] != null,
      ) &&
      value.isLoadingChecks === false
    );
  });
};

beforeAll(async () => {
  mock.module("sonner", () => ({
    toast: Object.assign(
      (message: string, options?: { description?: string; id?: string; duration?: number }) =>
        toastMessage(message, options),
      {
        success: (
          message: string,
          options?: { description?: string; id?: string; duration?: number },
        ) => toastMessage(message, options),
        error: (
          message: string,
          options?: { description?: string; id?: string; duration?: number },
        ) => toastError(message, options),
        dismiss: (toastId?: string | number) => toastDismiss(toastId),
      },
    ),
  }));
  ({ useChecks } = await import("./use-checks"));
});

beforeEach(async () => {
  Object.assign(host, originalHostMethods);
  toastMessage.mockClear();
  toastError.mockClear();
  toastDismiss.mockClear();
  checkRepoRuntimeHealthMock.mockClear();
  repoHealthHandler = async () => makeRepoHealth();
});

afterAll(async () => {
  Object.assign(host, originalHostMethods);
  await restoreMockedModules([["sonner", () => import("sonner")]]);
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

  test("does not surface Beads failures while backend reports initialization in progress", async () => {
    const runtimeCheck = mock(
      async (_force?: boolean): Promise<RuntimeCheck> => makeRuntimeCheck(),
    );
    const beadsCheck = mock(
      async (): Promise<BeadsCheck> =>
        makeBeadsCheck({
          beadsOk: false,
          beadsPath: "/repo/.beads",
          beadsError: "Beads task store initialization is in progress for /repo-a",
          repoStoreHealth: {
            category: "initializing",
            status: "initializing",
            isReady: false,
            detail: "Beads task store initialization is in progress for /repo-a",
            attachment: {
              path: "/repo/.beads",
              databaseName: "repo_db",
            },
            sharedServer: {
              host: "127.0.0.1",
              port: 38240,
              ownershipState: "unavailable",
            },
          },
        }),
    );
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
      await harness.waitFor(
        (value) => value.runtimeCheck !== null && value.activeBeadsCheck !== null,
      );

      const current = harness.getLatest();
      expect(current.activeBeadsCheck?.repoStoreHealth.status).toBe("initializing");
      expect(current.beadsCheckFailureKind).toBeNull();
      expect(toastError).not.toHaveBeenCalledWith("Beads store unavailable", expect.anything());
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
      makeRepoHealth({ checkedAt: `${repoPath}-checked`, mcp: { toolIds: [repoPath] } });

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
      expect(harness.getLatest().activeRepoRuntimeHealthByRuntime.opencode?.mcp?.toolIds).toEqual([
        "/repo-a",
      ]);
      expect(harness.getLatest().hasCachedBeadsCheck("/repo-b")).toBe(true);
      expect(harness.getLatest().hasCachedRepoRuntimeHealth("/repo-b", ["opencode"])).toBe(true);
      expect(beadsCheck).toHaveBeenCalledTimes(1);
      expect(checkRepoRuntimeHealthMock).toHaveBeenCalledTimes(1);

      await harness.updateArgs({ activeRepo: "/repo-b" });
      expect(harness.getLatest().activeBeadsCheck?.beadsPath).toBe("/repo-b/.beads");
      expect(harness.getLatest().activeRepoRuntimeHealthByRuntime.opencode?.mcp?.toolIds).toEqual([
        "/repo-b",
      ]);

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

  test("deduplicates runtime health error toasts across manual refreshes", async () => {
    const runtimeCheck = mock(
      async (_force?: boolean): Promise<RuntimeCheck> => makeRuntimeCheck(),
    );
    const beadsCheck = mock(async (): Promise<BeadsCheck> => makeBeadsCheck());
    repoHealthHandler = async () =>
      makeRepoHealth({
        status: "error",
        mcp: {
          supported: true,
          status: "error",
          serverName: "openducktor",
          serverStatus: null,
          toolIds: [],
          detail: "mcp offline",
          failureKind: "error",
        },
      });

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
      await waitForInitialChecksToSettle(harness, ["opencode"]);
      await harness.waitFor(() => toastError.mock.calls.length === 1);

      expect(toastError).toHaveBeenCalledWith(
        "OpenCode OpenDucktor MCP unavailable",
        expect.objectContaining({
          id: "diagnostics:mcp:opencode",
          description: "mcp offline",
        }),
      );

      toastError.mockClear();
      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(toastError).not.toHaveBeenCalled();
      expect(harness.getLatest().isLoadingChecks).toBe(false);
    } finally {
      await harness.unmount();
      host.runtimeCheck = original.runtimeCheck;
      host.beadsCheck = original.beadsCheck;
    }
  });

  test("shows cli and beads toasts for unhealthy successful payloads", async () => {
    let runtimeCallCount = 0;
    let beadsCallCount = 0;
    const runtimeCheck = mock(async (): Promise<RuntimeCheck> => {
      runtimeCallCount += 1;
      return runtimeCallCount === 1
        ? makeRuntimeCheck()
        : makeRuntimeCheck({
            gitOk: false,
            gitVersion: null,
            ghOk: false,
            ghVersion: null,
            ghAuthOk: false,
            ghAuthLogin: null,
            ghAuthError: "git missing",
            runtimes: [{ kind: "opencode", ok: false, version: null }],
            errors: ["git missing"],
          });
    });
    const beadsCheck = mock(async (): Promise<BeadsCheck> => {
      beadsCallCount += 1;
      return beadsCallCount === 1
        ? makeBeadsCheck()
        : makeBeadsCheck({
            beadsOk: false,
            beadsPath: null,
            beadsError: "beads offline",
            repoStoreHealth: {
              category: "attachment_verification_failed",
              status: "blocking",
              isReady: false,
              detail: "beads offline",
              attachment: {
                path: null,
              },
            },
          });
    });

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
      await waitForInitialChecksToSettle(harness, ["opencode"]);
      toastError.mockClear();

      await harness.run(async (value) => {
        await value.refreshChecks();
      });

      expect(toastError).toHaveBeenCalledWith(
        "CLI tools unavailable",
        expect.objectContaining({
          id: "diagnostics:cli-tools",
          description: "git missing",
        }),
      );
      expect(toastError).toHaveBeenCalledWith(
        "Beads store unavailable",
        expect.objectContaining({
          id: "diagnostics:beads-store",
          description: "beads offline",
        }),
      );
    } finally {
      await harness.unmount();
      host.runtimeCheck = original.runtimeCheck;
      host.beadsCheck = original.beadsCheck;
    }
  });

  test("refreshChecks starts independent probes in parallel", async () => {
    const runtimeDeferred = createDeferred<RuntimeCheck>();
    const beadsDeferred = createDeferred<BeadsCheck>();
    const runtimeHealthDeferred = createDeferred<RepoRuntimeHealthCheck>();
    let runtimeCallCount = 0;
    let beadsCallCount = 0;
    let runtimeHealthCallCount = 0;
    const runtimeCheck = mock(async (_force?: boolean): Promise<RuntimeCheck> => {
      runtimeCallCount += 1;
      return runtimeCallCount === 1 ? makeRuntimeCheck() : runtimeDeferred.promise;
    });
    const beadsCheck = mock(async (): Promise<BeadsCheck> => {
      beadsCallCount += 1;
      return beadsCallCount === 1 ? makeBeadsCheck() : beadsDeferred.promise;
    });
    repoHealthHandler = async () => {
      runtimeHealthCallCount += 1;
      return runtimeHealthCallCount === 1 ? makeRepoHealth() : runtimeHealthDeferred.promise;
    };

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

    let refreshPromise: Promise<void> | null = null;

    try {
      await waitForInitialChecksToSettle(harness);
      runtimeCheck.mockClear();
      beadsCheck.mockClear();
      checkRepoRuntimeHealthMock.mockClear();

      await harness.run((value) => {
        refreshPromise = captureDeferredRejection(value.refreshChecks());
      });
      await harness.waitFor((value) => value.isLoadingChecks === true);

      expect(runtimeCheck).toHaveBeenCalledTimes(1);
      expect(runtimeCheck.mock.calls[0]).toEqual([true]);
      expect(beadsCheck).toHaveBeenCalledTimes(1);
      expect(checkRepoRuntimeHealthMock).toHaveBeenCalledTimes(1);
      expect(checkRepoRuntimeHealthMock.mock.calls[0]).toEqual(["/repo-a", "opencode"]);

      runtimeDeferred.resolve(makeRuntimeCheck());
      beadsDeferred.resolve(makeBeadsCheck());
      runtimeHealthDeferred.resolve(makeRepoHealth());
      await harness.run(async () => {
        await refreshPromise;
      });
      await harness.waitFor((value) => value.isLoadingChecks === false);
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
    const beadsCheck = mock(async (): Promise<BeadsCheck> => makeBeadsCheck());
    repoHealthHandler = async () => makeRepoHealth();

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
        await value.refreshRuntimeCheck();
      });
      await harness.run(async (value) => {
        return expect(value.refreshChecks()).rejects.toThrow("runtime down");
      });
      await harness.waitFor(() => toastError.mock.calls.length === 1);

      expect(runtimeCheck).toHaveBeenCalledTimes(2);
      expect(runtimeCheck.mock.calls[0]).toEqual([false]);
      expect(runtimeCheck.mock.calls[1]).toEqual([true]);
      expect(toastError).toHaveBeenCalledWith(
        "CLI tools unavailable",
        expect.objectContaining({
          id: "diagnostics:cli-tools",
          description: "runtime down",
        }),
      );
      expect(harness.getLatest().isLoadingChecks).toBe(false);
    } finally {
      await harness.unmount();
      host.runtimeCheck = original.runtimeCheck;
      host.beadsCheck = original.beadsCheck;
    }
  });

  test("refreshChecks waits for all failed probes before surfacing unavailable diagnostics", async () => {
    const runtimeDeferred = createDeferred<RuntimeCheck>();
    const beadsDeferred = createDeferred<BeadsCheck>();
    const runtimeHealthDeferred = createDeferred<RepoRuntimeHealthCheck>();
    let runtimeCallCount = 0;
    let beadsCallCount = 0;
    let runtimeHealthCallCount = 0;
    const runtimeCheck = mock(async (_force?: boolean): Promise<RuntimeCheck> => {
      runtimeCallCount += 1;
      return runtimeCallCount === 1 ? makeRuntimeCheck() : runtimeDeferred.promise;
    });
    const beadsCheck = mock(async (): Promise<BeadsCheck> => {
      beadsCallCount += 1;
      return beadsCallCount === 1 ? makeBeadsCheck() : beadsDeferred.promise;
    });
    repoHealthHandler = async () => {
      runtimeHealthCallCount += 1;
      return runtimeHealthCallCount === 1 ? makeRepoHealth() : runtimeHealthDeferred.promise;
    };

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

    let refreshPromise: Promise<void> | null = null;

    try {
      await waitForInitialChecksToSettle(harness);
      runtimeCheck.mockClear();
      beadsCheck.mockClear();
      checkRepoRuntimeHealthMock.mockClear();

      await harness.run((value) => {
        refreshPromise = captureDeferredRejection(value.refreshChecks());
      });
      await harness.waitFor((value) => value.isLoadingChecks === true);

      runtimeDeferred.reject(new Error("runtime down"));
      await Promise.resolve();
      expect(toastError).not.toHaveBeenCalled();

      beadsDeferred.reject(new Error("beads down"));
      runtimeHealthDeferred.resolve(makeRepoHealth());
      await harness.run(async () => {
        return expect(refreshPromise).rejects.toThrow("runtime down");
      });
      await harness.waitFor((value) => value.isLoadingChecks === false);

      expect(toastError).toHaveBeenCalledWith(
        "CLI tools unavailable",
        expect.objectContaining({ id: "diagnostics:cli-tools", description: "runtime down" }),
      );
      expect(toastError).toHaveBeenCalledWith(
        "Beads store unavailable",
        expect.objectContaining({ id: "diagnostics:beads-store", description: "beads down" }),
      );
      expect(harness.getLatest().isLoadingChecks).toBe(false);
    } finally {
      await harness.unmount();
      host.runtimeCheck = original.runtimeCheck;
      host.beadsCheck = original.beadsCheck;
    }
  });

  test("refreshChecks times out hung probes and clears loading state", async () => {
    let runtimeCallCount = 0;
    let beadsCallCount = 0;
    const beadsDeferred = createDeferred<BeadsCheck>();
    const runtimeCheck = mock(async (_force?: boolean): Promise<RuntimeCheck> => {
      runtimeCallCount += 1;
      if (runtimeCallCount === 1) {
        return makeRuntimeCheck();
      }
      throw new Error("runtime down");
    });
    const beadsCheck = mock(async (): Promise<BeadsCheck> => {
      beadsCallCount += 1;
      return beadsCallCount === 1 ? makeBeadsCheck() : beadsDeferred.promise;
    });
    repoHealthHandler = async () => makeRepoHealth();

    const original = {
      runtimeCheck: host.runtimeCheck,
      beadsCheck: host.beadsCheck,
    };
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const diagnosticsTimeoutHandlers = new Map<number, () => void>();
    let nextDiagnosticsTimeoutId = 1;
    const setTimeoutMock = mock((handler: TimerHandler, delay?: number) => {
      if (typeof handler !== "function") {
        throw new Error("Expected timeout callback function");
      }

      if (delay === 2_000) {
        return 0 as unknown as ReturnType<typeof globalThis.setTimeout>;
      }

      if (delay === 15_000) {
        const timeoutId = nextDiagnosticsTimeoutId;
        nextDiagnosticsTimeoutId += 1;
        diagnosticsTimeoutHandlers.set(timeoutId, handler as () => void);
        return timeoutId as unknown as ReturnType<typeof globalThis.setTimeout>;
      }

      return originalSetTimeout(() => {
        handler();
      }, 0);
    });
    const clearTimeoutMock = mock((timeoutId: ReturnType<typeof globalThis.setTimeout>) => {
      if (typeof timeoutId === "number") {
        diagnosticsTimeoutHandlers.delete(timeoutId);
      }
      originalClearTimeout(timeoutId);
    });

    host.runtimeCheck = runtimeCheck;
    host.beadsCheck = beadsCheck;
    globalThis.setTimeout = setTimeoutMock as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = clearTimeoutMock as unknown as typeof globalThis.clearTimeout;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    let refreshPromise: Promise<void> | null = null;

    try {
      await waitForInitialChecksToSettle(harness);
      diagnosticsTimeoutHandlers.clear();
      runtimeCheck.mockClear();
      beadsCheck.mockClear();
      checkRepoRuntimeHealthMock.mockClear();

      await harness.run((value) => {
        refreshPromise = captureDeferredRejection(value.refreshChecks());
      });
      await harness.waitFor((value) => value.isLoadingChecks === true);
      expect(diagnosticsTimeoutHandlers.size).toBe(1);

      for (const handler of diagnosticsTimeoutHandlers.values()) {
        handler();
      }
      diagnosticsTimeoutHandlers.clear();

      await harness.run(async () => {
        return expect(refreshPromise).rejects.toThrow("runtime down");
      });
      await harness.waitFor((value) => value.isLoadingChecks === false);

      expect(toastError).toHaveBeenCalledWith(
        "CLI tools unavailable",
        expect.objectContaining({
          id: "diagnostics:cli-tools",
          description: "runtime down",
        }),
      );
      expect(toastMessage).not.toHaveBeenCalled();
      expect(harness.getLatest().isLoadingChecks).toBe(false);
    } finally {
      await harness.unmount();
      host.runtimeCheck = original.runtimeCheck;
      host.beadsCheck = original.beadsCheck;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      beadsDeferred.reject(new Error("cleanup"));
    }
  });

  test("projects runtime and beads query timeouts into concrete states instead of leaving checks pending", async () => {
    const runtimeDeferred = createDeferred<RuntimeCheck>();
    const beadsDeferred = createDeferred<BeadsCheck>();
    const original = {
      runtimeCheck: host.runtimeCheck,
      beadsCheck: host.beadsCheck,
    };
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;

    host.runtimeCheck = mock(async () => runtimeDeferred.promise);
    host.beadsCheck = mock(async () => beadsDeferred.promise);
    repoHealthHandler = async () => makeRepoHealth();

    globalThis.setTimeout = ((handler: TimerHandler, delay?: number) => {
      if (typeof handler !== "function") {
        throw new Error("Expected timeout callback function");
      }

      if (delay === 2_000) {
        return 0 as unknown as ReturnType<typeof globalThis.setTimeout>;
      }

      if (delay === 15_000) {
        return originalSetTimeout(() => {
          handler();
        }, 0);
      }

      return originalSetTimeout(() => {
        handler();
      }, delay);
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((timeoutId: ReturnType<typeof globalThis.setTimeout>) => {
      originalClearTimeout(timeoutId);
    }) as typeof globalThis.clearTimeout;

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (value) =>
          value.runtimeCheck?.errors[0] === "Timed out after 15000ms" &&
          value.activeBeadsCheck?.beadsError === "Timed out after 15000ms" &&
          value.runtimeCheckFailureKind === "timeout" &&
          value.beadsCheckFailureKind === "timeout" &&
          value.isLoadingChecks === false,
      );

      expect(toastMessage).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.runtimeCheck = original.runtimeCheck;
      host.beadsCheck = original.beadsCheck;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      runtimeDeferred.reject(new Error("cleanup"));
      beadsDeferred.reject(new Error("cleanup"));
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
        return expect(
          value.refreshRepoRuntimeHealthForRepo("/repo-a", true),
        ).resolves.toBeDefined();
      });

      await harness.waitFor((value) => {
        const runtimeHealth = value.activeRepoRuntimeHealthByRuntime.opencode;
        return runtimeHealth?.status === "error";
      });

      expect(harness.getLatest().activeRepoRuntimeHealthByRuntime.opencode).toEqual(
        expect.objectContaining({
          status: "error",
          runtime: expect.objectContaining({
            detail: "runtime health unreachable",
            failureKind: "error",
          }),
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
      return makeRepoHealth({ mcp: { toolIds: ["healthy"] } });
    };

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      await harness.waitFor((value) => {
        return value.activeRepoRuntimeHealthByRuntime.opencode?.status === "ready";
      });

      shouldFailRefresh = true;

      await harness.run(async (value) => {
        return expect(
          value.refreshRepoRuntimeHealthForRepo("/repo-a", true),
        ).resolves.toBeDefined();
      });

      await harness.waitFor((value) => {
        const runtimeHealth = value.activeRepoRuntimeHealthByRuntime.opencode;
        return runtimeHealth?.status === "error";
      });

      expect(harness.getLatest().activeRepoRuntimeHealthByRuntime.opencode).toEqual(
        expect.objectContaining({
          status: "error",
          runtime: expect.objectContaining({
            detail: "runtime health refresh failed",
            failureKind: "error",
          }),
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
      return makeRepoHealth({ mcp: { toolIds: [runtimeKind] } });
    };

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, MOCK_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();

      await harness.run(async (value) => {
        return expect(
          value.refreshRepoRuntimeHealthForRepo("/repo-a", true),
        ).resolves.toBeDefined();
      });

      await harness.waitFor((value) => {
        const opencodeHealth = value.activeRepoRuntimeHealthByRuntime.opencode;
        const mockRuntimeHealth = value.activeRepoRuntimeHealthByRuntime["mock-runtime"];
        return opencodeHealth != null && mockRuntimeHealth != null;
      });

      expect(harness.getLatest().activeRepoRuntimeHealthByRuntime.opencode).toEqual(
        expect.objectContaining({
          status: "ready",
          mcp: expect.objectContaining({ toolIds: ["opencode"] }),
        }),
      );
      expect(harness.getLatest().activeRepoRuntimeHealthByRuntime["mock-runtime"]).toEqual(
        expect.objectContaining({
          status: "error",
          runtime: expect.objectContaining({
            detail: "mock runtime probe failed",
            failureKind: "error",
          }),
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("retries timeout-classified runtime health without duplicating toasts", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let scheduledRetryCount = 0;
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number) => {
      if (typeof handler !== "function") {
        throw new Error("Expected retry timer handler to be a function");
      }

      if (delay === 2_000) {
        scheduledRetryCount += 1;
        return 0 as unknown as ReturnType<typeof globalThis.setTimeout>;
      }

      return originalSetTimeout(() => {
        handler();
      }, delay);
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((timerId: ReturnType<typeof globalThis.setTimeout>) => {
      return originalClearTimeout(timerId);
    }) as typeof globalThis.clearTimeout;

    let callCount = 0;
    repoHealthHandler = async () => {
      callCount += 1;

      if (callCount < 3) {
        return makeRepoHealth({
          status: "checking",
          runtime: {
            status: "checking",
            stage: "waiting_for_runtime",
            observation: null,
            instance: null,
            startedAt: null,
            updatedAt: "2026-02-22T08:00:00.000Z",
            elapsedMs: null,
            attempts: null,
            detail: "Timed out waiting for OpenCode runtime startup readiness",
            failureKind: "timeout",
            failureReason: null,
          },
          mcp: {
            supported: true,
            status: "waiting_for_runtime",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "Runtime is unavailable, so MCP cannot be verified.",
            failureKind: "timeout",
          },
        });
      }

      return makeRepoHealth();
    };

    const harness = createHookHarness({
      activeRepo: "/repo-a",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (value) =>
          value.activeRepoRuntimeHealthByRuntime.opencode?.runtime.failureKind === "timeout" &&
          value.isLoadingChecks === false,
      );

      expect(toastMessage).not.toHaveBeenCalled();
      expect(scheduledRetryCount).toBeGreaterThan(0);

      await harness.run(async () => {
        await harness.getLatest().refreshRepoRuntimeHealthForRepo("/repo-a", true);
      });
      await harness.waitFor(() => checkRepoRuntimeHealthMock.mock.calls.length === 2);
      expect(toastMessage).not.toHaveBeenCalled();

      await harness.run(async () => {
        await harness.getLatest().refreshRepoRuntimeHealthForRepo("/repo-a", true);
      });
      await harness.waitFor(
        (value) => value.activeRepoRuntimeHealthByRuntime.opencode?.status === "ready",
      );

      expect(toastMessage).not.toHaveBeenCalled();
      expect(toastDismiss).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type AgentRuntimes,
  DEFAULT_AGENT_RUNTIMES,
  knownRuntimeKindValues,
  type RuntimeExecutableCheck,
} from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/query-client";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { host } from "@/state/operations/host";
import { runtimeExecutableQueryOptions } from "@/state/queries/runtime";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import { useSettingsRuntimeExecutableSetup } from "./use-settings-runtime-executable-setup";

enableReactActEnvironment();

const runtimes: AgentRuntimes = {
  ...DEFAULT_AGENT_RUNTIMES,
  opencode: { enabled: true, executablePath: "/tools/opencode" },
};

const originalRuntimeExecutableCheck = host.runtimeExecutablesCheck;
afterEach(() => {
  host.runtimeExecutablesCheck = originalRuntimeExecutableCheck;
});

const createHarness = () => {
  const queryClient = createQueryClient();
  for (const kind of knownRuntimeKindValues) {
    const path = runtimes[kind].executablePath;
    queryClient.setQueryData(runtimeExecutableQueryOptions(kind, path).queryKey, {
      kind,
      path,
      ok: true,
      version: "1.0.0",
      error: null,
    });
  }
  const appliedRuntimes: AgentRuntimes[] = [];
  const applyUpdate = (updater: (current: AgentRuntimes) => AgentRuntimes): void => {
    appliedRuntimes.push(updater(appliedRuntimes.at(-1) ?? runtimes));
  };
  const wrapper = ({ children }: React.PropsWithChildren): React.ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const harness = createHookHarness(
    ({ open }: { open: boolean }) => {
      const setup = useSettingsRuntimeExecutableSetup({ open, runtimes });
      return {
        ...setup,
        checkAgain: () => setup.checkAgain(applyUpdate),
      };
    },
    { open: true },
    { wrapper },
  );
  return { ...harness, appliedRuntimes, applyUpdate };
};

const discoveredRuntimes = (prefix: string): RuntimeExecutableCheck => ({
  runtimes: knownRuntimeKindValues.map((kind) => ({
    kind,
    path: `/${prefix}/${kind}`,
    ok: true,
    version: "2.0.0",
    error: null,
  })),
});

describe("useSettingsRuntimeExecutableSetup", () => {
  test("keeps a rediscovery error until a successful retry replaces the paths", async () => {
    const failed = createDeferred<RuntimeExecutableCheck>();
    const succeeded = createDeferred<RuntimeExecutableCheck>();
    let attempts = 0;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode !== "discover") throw new Error("Expected runtime discovery");
      attempts += 1;
      return attempts === 1 ? failed.promise : succeeded.promise;
    });
    const harness = createHarness();

    try {
      await harness.mount();
      let request = Promise.resolve();
      await harness.run((state) => {
        request = state.checkAgain();
      });
      await harness.run(() => failed.reject(new Error("Runtime rediscovery failed")));
      await request;
      await harness.waitFor((state) => state.discoveryError === "Runtime rediscovery failed");

      await harness.run((state) => {
        request = state.checkAgain();
      });
      expect(harness.getLatest().discoveryError).toBe("Runtime rediscovery failed");
      await harness.run(() => succeeded.resolve(discoveredRuntimes("new")));
      await request;
      await harness.waitFor((state) => state.discoveryError === null);

      expect(harness.appliedRuntimes.at(-1)?.opencode.executablePath).toBe("/new/opencode");
    } finally {
      await harness.unmount();
    }
  });

  test("preserves executable paths edited while rediscovery is pending", async () => {
    const discovery = createDeferred<RuntimeExecutableCheck>();
    host.runtimeExecutablesCheck = mock(async () => discovery.promise);
    const harness = createHarness();

    try {
      await harness.mount();
      let request = Promise.resolve();
      await harness.run((state) => {
        request = state.checkAgain();
      });
      await harness.waitFor((state) => state.isCheckingDiscovery);

      harness.applyUpdate((current) => ({
        ...current,
        opencode: { ...current.opencode, executablePath: "/typed/opencode" },
      }));
      await harness.run(() => discovery.resolve(discoveredRuntimes("discovered")));
      await request;

      expect(harness.appliedRuntimes.at(-1)?.opencode.executablePath).toBe("/typed/opencode");
      expect(harness.appliedRuntimes.at(-1)?.codex.executablePath).toBe("/discovered/codex");
    } finally {
      await harness.unmount();
    }
  });

  test("ignores a rediscovery success from a closed Settings visit", async () => {
    const stale = createDeferred<RuntimeExecutableCheck>();
    host.runtimeExecutablesCheck = mock(async () => stale.promise);
    const harness = createHarness();

    try {
      await harness.mount();
      let request = Promise.resolve();
      await harness.run((state) => {
        request = state.checkAgain();
      });
      await harness.waitFor((state) => state.isCheckingDiscovery);
      await harness.update({ open: false });
      await harness.update({ open: true });
      await harness.run(() => stale.resolve(discoveredRuntimes("stale")));
      await request;

      expect(harness.appliedRuntimes).toHaveLength(0);
      expect(harness.getLatest().discoveryError).toBeNull();
      expect(harness.getLatest().isCheckingDiscovery).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("ignores a rediscovery failure from a closed Settings visit", async () => {
    const stale = createDeferred<RuntimeExecutableCheck>();
    host.runtimeExecutablesCheck = mock(async () => stale.promise);
    const harness = createHarness();

    try {
      await harness.mount();
      let request = Promise.resolve();
      await harness.run((state) => {
        request = state.checkAgain();
      });
      await harness.waitFor((state) => state.isCheckingDiscovery);
      await harness.update({ open: false });
      await harness.update({ open: true });
      await harness.run(() => stale.reject(new Error("Stale runtime discovery failed")));
      await request;

      expect(harness.getLatest().discoveryError).toBeNull();
      expect(harness.getLatest().error).toBeNull();
      expect(harness.getLatest().isCheckingDiscovery).toBe(false);
    } finally {
      await harness.unmount();
    }
  });
});

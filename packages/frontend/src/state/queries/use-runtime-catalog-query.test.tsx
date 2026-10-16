import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { HostRuntimeStatusContext } from "@/state/app-state-contexts";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  createHostRuntimeStatusContextValue,
  createHostRuntimeStatusFixture,
  createRuntimeCatalogFixture,
} from "@/test-utils/shared-test-fixtures";
import type { HostRuntimeStatusContextValue } from "@/types/state-slices";
import { runtimeCatalogQueryKeys } from "./runtime-catalog";
import { useRefreshStaleRuntimeCatalog, useRuntimeCatalogQuery } from "./use-runtime-catalog-query";

const runtimeRef: RuntimeWorkingDirectoryRef = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
};

const runtimeCatalog: AgentRuntimeCatalog = createRuntimeCatalogFixture({
  models: { runtime: OPENCODE_RUNTIME_DESCRIPTOR, models: [], defaultModelsByProvider: {} },
});

const startingRuntimeStatus = createHostRuntimeStatusContextValue({
  statusByKind: {
    opencode: createHostRuntimeStatusFixture({ kind: "opencode", state: "starting" }),
  },
});

const createWrapper = (
  queryClient: QueryClient,
  readRuntimeStatus: () => HostRuntimeStatusContextValue,
) =>
  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <HostRuntimeStatusContext value={readRuntimeStatus()}>{children}</HostRuntimeStatusContext>
      </QueryClientProvider>
    );
  };

describe("useRuntimeCatalogQuery", () => {
  test("reads the catalog only after its runtime kind becomes ready", async () => {
    const queryClient = new QueryClient();
    let runtimeStatus = startingRuntimeStatus;
    const loadRuntimeCatalog = mock(async () => runtimeCatalog);
    const props = { runtimeRef, loadRuntimeCatalog };
    const harness = createHookHarness(useRuntimeCatalogQuery, props, {
      wrapper: createWrapper(queryClient, () => runtimeStatus),
    });

    try {
      await harness.mount();
      expect(loadRuntimeCatalog).not.toHaveBeenCalled();

      runtimeStatus = createHostRuntimeStatusContextValue();
      await harness.update(props);
      await harness.waitFor((query) => query.data !== undefined, 2000);

      expect(loadRuntimeCatalog).toHaveBeenCalledWith(runtimeRef);
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("keeps a caller-disabled read off when the runtime is ready", async () => {
    const queryClient = new QueryClient();
    const loadRuntimeCatalog = mock(async () => runtimeCatalog);
    const harness = createHookHarness(
      useRuntimeCatalogQuery,
      { runtimeRef, loadRuntimeCatalog, enabled: false },
      { wrapper: createWrapper(queryClient, () => createHostRuntimeStatusContextValue()) },
    );

    try {
      await harness.mount();
      expect(loadRuntimeCatalog).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });
});

describe("useRefreshStaleRuntimeCatalog", () => {
  test("reads a stale entry, reuses a fresh one, and skips a runtime that is not ready", async () => {
    const queryClient = new QueryClient();
    const queryKey = runtimeCatalogQueryKeys.catalog(runtimeRef);
    let runtimeStatus = createHostRuntimeStatusContextValue();
    const loadRuntimeCatalog = mock(async () => runtimeCatalog);
    const harness = createHookHarness(useRefreshStaleRuntimeCatalog, loadRuntimeCatalog, {
      wrapper: createWrapper(queryClient, () => runtimeStatus),
    });

    try {
      await harness.mount();
      queryClient.setQueryData(queryKey, runtimeCatalog);
      await harness.run((refresh) => refresh(runtimeRef));
      expect(loadRuntimeCatalog).not.toHaveBeenCalled();

      queryClient.setQueryData(queryKey, runtimeCatalog, { updatedAt: 0 });
      runtimeStatus = startingRuntimeStatus;
      await harness.update(loadRuntimeCatalog);
      await harness.run((refresh) => refresh(runtimeRef));
      expect(loadRuntimeCatalog).not.toHaveBeenCalled();

      runtimeStatus = createHostRuntimeStatusContextValue();
      await harness.update(loadRuntimeCatalog);
      await harness.run((refresh) => refresh(runtimeRef));
      await harness.waitFor(() => loadRuntimeCatalog.mock.calls.length === 1, 2000);
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });
});

import "../test-support/dom-environment";
import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRuntimeCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import { HostRuntimeStatusContext } from "../sessions/session-contexts";
import { IsolatedQueryWrapper } from "../test-support/isolated-query-wrapper";
import { createHookHarness } from "../test-support/react-hook-harness";
import {
  createDeferred,
  createHostRuntimeStatusContextValue,
  createHostRuntimeStatusFixture,
  createRuntimeCatalogFixture,
} from "../test-support/shared-test-fixtures";
import { useRuntimeModelCatalogQuery, useRuntimeModelCatalogs } from "./use-runtime-model-catalogs";

const descriptorByRuntime = {
  opencode: OPENCODE_RUNTIME_DESCRIPTOR,
  codex: CODEX_RUNTIME_DESCRIPTOR,
  claude: CLAUDE_RUNTIME_DESCRIPTOR,
};

const catalogFor = (runtimeKind: RuntimeKind): AgentModelCatalog => ({
  runtime: descriptorByRuntime[runtimeKind],
  models: [],
  profiles: [],
  defaultModelsByProvider: {},
});

const runtimeCatalogFor = (runtimeKind: RuntimeKind): AgentRuntimeCatalog =>
  createRuntimeCatalogFixture({ models: catalogFor(runtimeKind) });

const readyRuntimeStatus = createHostRuntimeStatusContextValue();

const runtimeStatusRef = { current: readyRuntimeStatus };

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <IsolatedQueryWrapper>
    <HostRuntimeStatusContext value={runtimeStatusRef.current}>{children}</HostRuntimeStatusContext>
  </IsolatedQueryWrapper>
);

afterEach(() => {
  runtimeStatusRef.current = readyRuntimeStatus;
});

describe("useRuntimeModelCatalogs", () => {
  test("keeps cached catalog data without a loading state during a background refetch", async () => {
    const refetch = createDeferred<AgentRuntimeCatalog>();
    let loadAttempt = 0;
    const loadCatalog = mock(async (runtimeRef: RuntimeWorkingDirectoryRef) => {
      loadAttempt += 1;
      if (loadAttempt === 2) {
        return refetch.promise;
      }
      return runtimeCatalogFor(runtimeRef.runtimeKind);
    });
    const harness = createHookHarness(
      useRuntimeModelCatalogs,
      {
        repoPath: "/repo",
        runtimeKinds: ["opencode"] as const,
        enabledRuntimeKinds: ["opencode"] as const,
        loadRuntimeCatalog: loadCatalog,
      },
      { wrapper },
    );

    await harness.mount();
    await harness.waitFor((state) => state.resources[0]?.catalog !== null, 2000);
    await harness.run((state) => {
      void state.resources[0]?.retry();
    });
    await harness.waitFor(() => loadAttempt === 2, 2000);

    expect(harness.getLatest().resources[0]).toEqual(
      expect.objectContaining({
        catalog: catalogFor("opencode"),
        isLoading: false,
        error: null,
      }),
    );

    refetch.resolve(runtimeCatalogFor("opencode"));
    await harness.unmount();
  });

  test("waits for a starting runtime before it reads the catalog", async () => {
    const loadCatalog = mock(async (runtimeRef: RuntimeWorkingDirectoryRef) =>
      runtimeCatalogFor(runtimeRef.runtimeKind),
    );
    const props = {
      repoPath: "/repo",
      runtimeKinds: ["opencode"] as const,
      enabledRuntimeKinds: ["opencode"] as const,
      loadRuntimeCatalog: loadCatalog,
    };
    runtimeStatusRef.current = createHostRuntimeStatusContextValue({
      statusByKind: {
        opencode: createHostRuntimeStatusFixture({ kind: "opencode", state: "starting" }),
      },
    });
    const harness = createHookHarness(useRuntimeModelCatalogs, props, { wrapper });

    await harness.mount();
    expect(harness.getLatest().resources[0]).toEqual(
      expect.objectContaining({ catalog: null, isLoading: true, error: null }),
    );
    expect(loadCatalog).not.toHaveBeenCalled();

    runtimeStatusRef.current = readyRuntimeStatus;
    await harness.update(props);
    await harness.waitFor((state) => state.resources[0]?.catalog !== null, 2000);

    expect(harness.getLatest().resources[0]?.isLoading).toBe(false);
    expect(loadCatalog).toHaveBeenCalledTimes(1);
    await harness.unmount();
  });

  test("keeps each runtime loading and error state independent", async () => {
    const loadCatalog = mock(async (runtimeRef: RuntimeWorkingDirectoryRef) => {
      if (runtimeRef.runtimeKind === "codex") {
        throw new Error("Codex catalog failed");
      }
      return runtimeCatalogFor(runtimeRef.runtimeKind);
    });
    const harness = createHookHarness(
      useRuntimeModelCatalogs,
      {
        repoPath: "/repo",
        runtimeKinds: ["opencode", "codex"] as const,
        enabledRuntimeKinds: ["opencode", "codex"] as const,
        loadRuntimeCatalog: loadCatalog,
      },
      { wrapper },
    );

    await harness.mount();
    await harness.waitFor(
      (state) => state.resources.every((resource) => !resource.isLoading),
      2000,
    );

    expect(harness.getLatest().resources).toEqual([
      expect.objectContaining({
        runtimeKind: "opencode",
        catalog: catalogFor("opencode"),
        error: null,
      }),
      expect.objectContaining({
        runtimeKind: "codex",
        catalog: null,
        error: "Codex catalog failed",
      }),
    ]);
    expect(loadCatalog).toHaveBeenCalledTimes(2);
    await harness.unmount();
  });

  test("loads only enabled runtimes and supports a user retry", async () => {
    let codexAttempts = 0;
    const loadCatalog = mock(async (runtimeRef: RuntimeWorkingDirectoryRef) => {
      if (runtimeRef.runtimeKind === "codex") {
        codexAttempts += 1;
        if (codexAttempts === 1) {
          throw new Error("Codex catalog failed");
        }
      }
      return runtimeCatalogFor(runtimeRef.runtimeKind);
    });
    const harness = createHookHarness(
      useRuntimeModelCatalogs,
      {
        repoPath: "/repo",
        runtimeKinds: ["opencode", "codex"] as const,
        enabledRuntimeKinds: ["codex"] as const,
        loadRuntimeCatalog: loadCatalog,
      },
      { wrapper },
    );

    await harness.mount();
    await harness.waitFor((state) => state.resources[1]?.error !== null, 2000);
    expect(harness.getLatest().resources[0]).toEqual(
      expect.objectContaining({ runtimeKind: "opencode", catalog: null, isLoading: false }),
    );

    await harness.run(async (state) => {
      await state.resources[1]?.retry();
    });
    await harness.waitFor((state) => state.resources[1]?.catalog !== null, 2000);

    expect(harness.getLatest().resources[1]).toEqual(
      expect.objectContaining({ runtimeKind: "codex", catalog: catalogFor("codex"), error: null }),
    );
    expect(loadCatalog).toHaveBeenCalledTimes(2);
    await harness.unmount();
  });

  test("keeps cached catalog data next to the error after a failed refetch", async () => {
    let readShouldFail = false;
    const loadCatalog = mock(async (runtimeRef: RuntimeWorkingDirectoryRef) => {
      if (readShouldFail) {
        throw new Error("OpenCode catalog refetch failed");
      }
      return runtimeCatalogFor(runtimeRef.runtimeKind);
    });
    const harness = createHookHarness(
      useRuntimeModelCatalogs,
      {
        repoPath: "/repo",
        runtimeKinds: ["opencode"] as const,
        enabledRuntimeKinds: ["opencode"] as const,
        loadRuntimeCatalog: loadCatalog,
      },
      { wrapper },
    );

    await harness.mount();
    await harness.waitFor((state) => state.resources[0]?.catalog !== null, 2000);
    readShouldFail = true;
    await harness.run(async (state) => {
      await state.resources[0]?.retry();
    });
    await harness.waitFor((state) => state.resources[0]?.error !== null, 2000);
    expect(harness.getLatest().resources[0]).toEqual(
      expect.objectContaining({
        catalog: catalogFor("opencode"),
        isLoading: false,
        error: "OpenCode catalog refetch failed",
      }),
    );

    readShouldFail = false;
    await harness.run(async (state) => {
      await state.resources[0]?.retry();
    });
    await harness.waitFor((state) => state.resources[0]?.error === null, 2000);
    expect(harness.getLatest().resources[0]?.catalog).toEqual(catalogFor("opencode"));
    await harness.unmount();
  });

  test("explains a runtime that cannot serve its catalog without reading it", async () => {
    const loadCatalog = mock(async (runtimeRef: RuntimeWorkingDirectoryRef) =>
      runtimeCatalogFor(runtimeRef.runtimeKind),
    );
    runtimeStatusRef.current = createHostRuntimeStatusContextValue({
      statusByKind: {
        opencode: createHostRuntimeStatusFixture({ kind: "opencode", state: "disabled" }),
      },
    });
    const harness = createHookHarness(
      useRuntimeModelCatalogs,
      {
        repoPath: "/repo",
        runtimeKinds: ["opencode"] as const,
        enabledRuntimeKinds: ["opencode"] as const,
        loadRuntimeCatalog: loadCatalog,
      },
      { wrapper },
    );

    await harness.mount();

    expect(harness.getLatest().resources[0]).toEqual(
      expect.objectContaining({
        catalog: null,
        isLoading: false,
        error: null,
        unavailableReason: expect.stringContaining("OpenCode"),
      }),
    );
    expect(loadCatalog).not.toHaveBeenCalled();
    await harness.unmount();
  });

  test("hides a read error and offers no retry while the runtime is not ready", async () => {
    const loadCatalog = mock(async (): Promise<AgentRuntimeCatalog> => {
      throw new Error("OpenCode catalog read failed");
    });
    const props = {
      repoPath: "/repo",
      runtimeKinds: ["opencode"] as const,
      enabledRuntimeKinds: ["opencode"] as const,
      loadRuntimeCatalog: loadCatalog,
    };
    const harness = createHookHarness(useRuntimeModelCatalogs, props, { wrapper });

    await harness.mount();
    await harness.waitFor(
      (state) => state.resources[0]?.error === "OpenCode catalog read failed",
      2000,
    );

    runtimeStatusRef.current = createHostRuntimeStatusContextValue({
      statusByKind: {
        opencode: createHostRuntimeStatusFixture({ kind: "opencode", state: "restarting" }),
      },
    });
    await harness.update(props);
    expect(harness.getLatest().resources[0]).toEqual(
      expect.objectContaining({ catalog: null, isLoading: true, error: null }),
    );

    runtimeStatusRef.current = createHostRuntimeStatusContextValue({
      statusByKind: {
        opencode: createHostRuntimeStatusFixture({ kind: "opencode", state: "error" }),
      },
    });
    await harness.update(props);
    expect(harness.getLatest().resources[0]).toEqual(
      expect.objectContaining({
        isLoading: false,
        error: null,
        unavailableReason: expect.stringContaining("OpenCode"),
      }),
    );
    expect(loadCatalog).toHaveBeenCalledTimes(1);
    await harness.unmount();
  });

  test("keeps cached models next to a failed model response until a read succeeds", async () => {
    const refreshedCatalog: AgentModelCatalog = {
      ...catalogFor("opencode"),
      defaultModelsByProvider: { openai: "gpt-5" },
    };
    const responses: AgentRuntimeCatalog[] = [
      runtimeCatalogFor("opencode"),
      { models: { status: "failed", message: "OpenCode model list failed" } },
      { models: { status: "failed", message: "OpenCode model list failed again" } },
      createRuntimeCatalogFixture({ models: refreshedCatalog }),
    ];
    const loadCatalog = mock(async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error("unexpected catalog read");
      }
      return response;
    });
    const harness = createHookHarness(
      useRuntimeModelCatalogs,
      {
        repoPath: "/repo",
        runtimeKinds: ["opencode"] as const,
        enabledRuntimeKinds: ["opencode"] as const,
        loadRuntimeCatalog: loadCatalog,
      },
      { wrapper },
    );

    await harness.mount();
    await harness.waitFor((state) => state.resources[0]?.catalog !== null, 2000);
    for (const message of ["OpenCode model list failed", "OpenCode model list failed again"]) {
      await harness.run(async (state) => {
        await state.resources[0]?.retry();
      });
      await harness.waitFor((state) => state.resources[0]?.error === message, 2000);
      expect(harness.getLatest().resources[0]).toEqual(
        expect.objectContaining({ catalog: catalogFor("opencode"), isLoading: false }),
      );
    }

    await harness.run(async (state) => {
      await state.resources[0]?.retry();
    });
    await harness.waitFor((state) => state.resources[0]?.error === null, 2000);
    expect(harness.getLatest().resources[0]?.catalog).toEqual(refreshedCatalog);
    await harness.unmount();
  });

  test("shows one runtime directory as loading while its runtime starts", async () => {
    const loadCatalog = mock(async (runtimeRef: RuntimeWorkingDirectoryRef) =>
      runtimeCatalogFor(runtimeRef.runtimeKind),
    );
    const props = {
      runtimeRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/wt",
      } as const,
      loadRuntimeCatalog: loadCatalog,
    };
    runtimeStatusRef.current = createHostRuntimeStatusContextValue({
      statusByKind: {
        opencode: createHostRuntimeStatusFixture({ kind: "opencode", state: "starting" }),
      },
    });
    const harness = createHookHarness(useRuntimeModelCatalogQuery, props, { wrapper });

    await harness.mount();
    expect(harness.getLatest()).toEqual(
      expect.objectContaining({ catalog: null, isLoading: true, error: null }),
    );
    expect(loadCatalog).not.toHaveBeenCalled();

    runtimeStatusRef.current = readyRuntimeStatus;
    await harness.update(props);
    await harness.waitFor((state) => state.catalog !== null, 2000);

    expect(harness.getLatest().isLoading).toBe(false);
    expect(loadCatalog).toHaveBeenCalledTimes(1);
    await harness.unmount();
  });
});

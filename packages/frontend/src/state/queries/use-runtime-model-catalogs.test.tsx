import { describe, expect, mock, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoRuntimeRef,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import { useRuntimeModelCatalogs } from "./use-runtime-model-catalogs";

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

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <IsolatedQueryWrapper>{children}</IsolatedQueryWrapper>
);

describe("useRuntimeModelCatalogs", () => {
  test("marks retained catalog data as loading during a background refetch", async () => {
    const refetch = createDeferred<AgentModelCatalog>();
    let loadAttempt = 0;
    const loadCatalog = mock(async (runtimeRef: RepoRuntimeRef) => {
      loadAttempt += 1;
      if (loadAttempt === 2) {
        return refetch.promise;
      }
      return catalogFor(runtimeRef.runtimeKind);
    });
    const harness = createHookHarness(
      useRuntimeModelCatalogs,
      {
        repoPath: "/repo",
        runtimeKinds: ["opencode"] as const,
        enabledRuntimeKinds: ["opencode"] as const,
        loadCatalog,
      },
      { wrapper },
    );

    await harness.mount();
    await harness.waitFor((state) => state.resources[0]?.catalog !== null, 2000);
    await harness.run((state) => {
      void state.resources[0]?.retry();
    });
    await harness.waitFor((state) => state.resources[0]?.isFetching === true, 2000);

    expect(harness.getLatest().resources[0]).toEqual(
      expect.objectContaining({
        catalog: catalogFor("opencode"),
        isFetching: true,
        error: null,
      }),
    );

    refetch.resolve(catalogFor("opencode"));
    await harness.waitFor((state) => state.resources[0]?.isFetching === false, 2000);
    expect(harness.getLatest().resources[0]?.catalog).toEqual(catalogFor("opencode"));
    await harness.unmount();
  });

  test("keeps each runtime loading and error state independent", async () => {
    const loadCatalog = mock(async (runtimeRef: RepoRuntimeRef) => {
      if (runtimeRef.runtimeKind === "codex") {
        throw new Error("Codex catalog failed");
      }
      return catalogFor(runtimeRef.runtimeKind);
    });
    const harness = createHookHarness(
      useRuntimeModelCatalogs,
      {
        repoPath: "/repo",
        runtimeKinds: ["opencode", "codex"] as const,
        enabledRuntimeKinds: ["opencode", "codex"] as const,
        loadCatalog,
      },
      { wrapper },
    );

    await harness.mount();
    await harness.waitFor(
      (state) => state.resources.every((resource) => !resource.isFetching),
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
    const loadCatalog = mock(async (runtimeRef: RepoRuntimeRef) => {
      if (runtimeRef.runtimeKind === "codex") {
        codexAttempts += 1;
        if (codexAttempts === 1) {
          throw new Error("Codex catalog failed");
        }
      }
      return catalogFor(runtimeRef.runtimeKind);
    });
    const harness = createHookHarness(
      useRuntimeModelCatalogs,
      {
        repoPath: "/repo",
        runtimeKinds: ["opencode", "codex"] as const,
        enabledRuntimeKinds: ["codex"] as const,
        loadCatalog,
      },
      { wrapper },
    );

    await harness.mount();
    await harness.waitFor((state) => state.resources[1]?.error !== null, 2000);
    expect(harness.getLatest().resources[0]).toEqual(
      expect.objectContaining({ runtimeKind: "opencode", catalog: null, isFetching: false }),
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

  test("removes retained catalog data from selection after a failed refetch", async () => {
    let readShouldFail = false;
    const loadCatalog = mock(async (runtimeRef: RepoRuntimeRef) => {
      if (readShouldFail) {
        throw new Error("OpenCode catalog refetch failed");
      }
      return catalogFor(runtimeRef.runtimeKind);
    });
    const harness = createHookHarness(
      useRuntimeModelCatalogs,
      {
        repoPath: "/repo",
        runtimeKinds: ["opencode"] as const,
        enabledRuntimeKinds: ["opencode"] as const,
        loadCatalog,
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
        catalog: null,
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
});

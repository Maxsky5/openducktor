import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useRepoRuntimeHealthWarmup } from "./use-repo-runtime-health-warmup";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useRepoRuntimeHealthWarmup>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useRepoRuntimeHealthWarmup, initialProps);

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  workspaceRepoPath: "/repo-a",
  runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
  isLoadingChecks: false,
  hasCachedRepoRuntimeHealth: () => false,
  refreshRepoRuntimeHealthForRepo: mock(async () => ({})),
  ...overrides,
});

describe("useRepoRuntimeHealthWarmup", () => {
  test("warms repo runtime health when no cached runtime health exists", async () => {
    const refreshRepoRuntimeHealthForRepo = mock(async () => ({}));
    const hasCachedRepoRuntimeHealth = mock(() => false);
    const harness = createHookHarness(
      createBaseArgs({
        hasCachedRepoRuntimeHealth,
        refreshRepoRuntimeHealthForRepo,
      }),
    );

    try {
      await harness.mount();

      expect(hasCachedRepoRuntimeHealth).toHaveBeenCalledWith("/repo-a", ["opencode"]);
      expect(refreshRepoRuntimeHealthForRepo).toHaveBeenCalledWith("/repo-a", false);
    } finally {
      await harness.unmount();
    }
  });

  test("skips warmup while unavailable, loading, or already cached", async () => {
    const refreshRepoRuntimeHealthForRepo = mock(async () => ({}));
    const hasCachedRepoRuntimeHealth = mock(() => true);
    const hasNoCachedRepoRuntimeHealth = mock(() => false);
    const harness = createHookHarness(
      createBaseArgs({
        workspaceRepoPath: null,
        hasCachedRepoRuntimeHealth,
        refreshRepoRuntimeHealthForRepo,
      }),
    );

    try {
      await harness.mount();
      await harness.update(
        createBaseArgs({
          runtimeDefinitions: [],
          hasCachedRepoRuntimeHealth: hasNoCachedRepoRuntimeHealth,
          refreshRepoRuntimeHealthForRepo,
        }),
      );
      await harness.update(
        createBaseArgs({
          isLoadingChecks: true,
          hasCachedRepoRuntimeHealth: hasNoCachedRepoRuntimeHealth,
          refreshRepoRuntimeHealthForRepo,
        }),
      );
      await harness.update(
        createBaseArgs({
          hasCachedRepoRuntimeHealth,
          refreshRepoRuntimeHealthForRepo,
        }),
      );

      expect(hasNoCachedRepoRuntimeHealth).not.toHaveBeenCalled();
      expect(refreshRepoRuntimeHealthForRepo).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });
});

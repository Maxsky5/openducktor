import { beforeEach, describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeKind } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useRepoRuntimeHealth } from "./use-repo-runtime-health";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useRepoRuntimeHealth>[0];

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

const readyRepoHealth = (): RepoRuntimeHealthCheck =>
  createRepoRuntimeHealthFixture({
    mcp: { toolIds: ["odt_read_task"] },
  });

let repoHealthHandler = async (
  _repoPath: string,
  _runtimeKind: RuntimeKind,
): Promise<RepoRuntimeHealthCheck> => readyRepoHealth();

const checkRepoRuntimeHealth = mock((repoPath: string, runtimeKind: RuntimeKind) =>
  repoHealthHandler(repoPath, runtimeKind),
);

const createHarness = (initialArgs: Partial<HookArgs>) => {
  const defaultArgs: HookArgs = {
    activeWorkspace: createActiveWorkspace("/repo-a"),
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    checkRepoRuntimeHealth,
  };
  return createHookHarness(
    useRepoRuntimeHealth,
    {
      ...defaultArgs,
      ...initialArgs,
    },
    { wrapper },
  );
};

beforeEach(() => {
  checkRepoRuntimeHealth.mockClear();
  repoHealthHandler = async () => readyRepoHealth();
});

describe("useRepoRuntimeHealth", () => {
  test("does not start runtime health checks without an active repository", async () => {
    const harness = createHarness({ activeWorkspace: null });

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await expect(state.refreshRepoRuntimeHealth()).resolves.toEqual({});
      });

      expect(checkRepoRuntimeHealth).not.toHaveBeenCalled();
      expect(harness.getLatest().activeRepoRuntimeHealthByRuntime).toEqual({});
      expect(harness.getLatest().isLoadingRepoRuntimeHealth).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("loads repository runtime health when runtime definitions become available", async () => {
    const harness = createHarness({ runtimeDefinitions: [] });

    try {
      await harness.mount();
      expect(checkRepoRuntimeHealth).not.toHaveBeenCalled();

      await harness.update({
        activeWorkspace: createActiveWorkspace("/repo-a"),
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        checkRepoRuntimeHealth,
      });
      await harness.waitFor(
        (state) => state.activeRepoRuntimeHealthByRuntime.opencode?.status === "ready",
      );

      expect(checkRepoRuntimeHealth).toHaveBeenCalledTimes(1);
      expect(checkRepoRuntimeHealth.mock.calls[0]).toEqual(["/repo-a", "opencode"]);
    } finally {
      await harness.unmount();
    }
  });

  test("refreshRepoRuntimeHealth forces a fresh runtime health read", async () => {
    let callCount = 0;
    repoHealthHandler = async () => {
      callCount += 1;
      return readyRepoHealth();
    };
    const harness = createHarness({});

    try {
      await harness.mount();
      await harness.waitFor(
        (state) => state.activeRepoRuntimeHealthByRuntime.opencode?.status === "ready",
      );
      checkRepoRuntimeHealth.mockClear();

      await harness.run(async (state) => {
        await state.refreshRepoRuntimeHealth();
      });

      expect(checkRepoRuntimeHealth).toHaveBeenCalledTimes(1);
      expect(callCount).toBe(2);
    } finally {
      await harness.unmount();
    }
  });
});

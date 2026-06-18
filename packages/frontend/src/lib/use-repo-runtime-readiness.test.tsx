import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createRepoRuntimeHealthFixture,
  type RepoRuntimeHealthFixtureOverrides,
} from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { useRepoRuntimeReadiness } from "./use-repo-runtime-readiness";

const makeRepoHealth = (
  overrides: RepoRuntimeHealthFixtureOverrides = {},
): RepoRuntimeHealthCheck =>
  createRepoRuntimeHealthFixture({ checkedAt: "2026-02-20T12:01:00.000Z" }, overrides);

const SECOND_RUNTIME_DESCRIPTOR: RuntimeDescriptor = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  kind: "opencode",
  label: "Mock Runtime",
};

describe("useRepoRuntimeReadiness", () => {
  test("returns timeout-specific blocked copy while runtime health is warming up", async () => {
    let latest: ReturnType<typeof useRepoRuntimeReadiness> | null = null;

    const Harness = ({ args }: { args: Parameters<typeof useRepoRuntimeReadiness>[0] }) => {
      latest = useRepoRuntimeReadiness(args);
      return null;
    };

    const harness = createSharedHookHarness(Harness, {
      args: {
        hasWorkspace: true,
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        isLoadingRuntimeDefinitions: false,
        runtimeDefinitionsError: null,
        runtimeHealthByRuntime: {
          opencode: makeRepoHealth({
            status: "checking",
            runtime: {
              status: "checking",
              stage: "waiting_for_runtime",
              observation: "started_by_diagnostics",
              instance: null,
              startedAt: "2026-02-20T12:00:55.000Z",
              updatedAt: "2026-02-20T12:01:00.000Z",
              elapsedMs: 5000,
              attempts: 4,
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
          }),
        },
        isLoadingChecks: false,
        refreshChecks: async () => {},
      },
    });

    try {
      await harness.mount();
      if (!latest) {
        throw new Error("Expected readiness hook to mount");
      }

      const readiness = latest as ReturnType<typeof useRepoRuntimeReadiness>;
      expect(readiness.state).toBe("checking");
      expect(readiness.message).toContain("runtime is starting");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps MCP-stage copy when frontend times out during host MCP work", async () => {
    let latest: ReturnType<typeof useRepoRuntimeReadiness> | null = null;

    const Harness = ({ args }: { args: Parameters<typeof useRepoRuntimeReadiness>[0] }) => {
      latest = useRepoRuntimeReadiness(args);
      return null;
    };

    const harness = createSharedHookHarness(Harness, {
      args: {
        hasWorkspace: true,
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        isLoadingRuntimeDefinitions: false,
        runtimeDefinitionsError: null,
        runtimeHealthByRuntime: {
          opencode: makeRepoHealth({
            status: "checking",
            runtime: {
              status: "ready",
              stage: "runtime_ready",
              observation: "observed_existing_runtime",
              instance: null,
              startedAt: "2026-02-20T12:00:55.000Z",
              updatedAt: "2026-02-20T12:01:00.000Z",
              elapsedMs: 5000,
              attempts: 4,
              detail: null,
              failureKind: null,
              failureReason: null,
            },
            mcp: {
              supported: true,
              status: "checking",
              serverName: "openducktor",
              serverStatus: null,
              toolIds: [],
              detail: "Timed out after 15000ms",
              failureKind: "timeout",
            },
          }),
        },
        isLoadingChecks: false,
        refreshChecks: async () => {},
      },
    });

    try {
      await harness.mount();
      if (!latest) {
        throw new Error("Expected readiness hook to mount");
      }

      const readiness = latest as ReturnType<typeof useRepoRuntimeReadiness>;
      expect(readiness.state).toBe("checking");
      expect(readiness.message).toContain("Checking OpenDucktor MCP");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps checking reason aligned with the runtime driving the global checking state", async () => {
    let latest: ReturnType<typeof useRepoRuntimeReadiness> | null = null;

    const Harness = ({ args }: { args: Parameters<typeof useRepoRuntimeReadiness>[0] }) => {
      latest = useRepoRuntimeReadiness(args);
      return null;
    };

    const harness = createSharedHookHarness(Harness, {
      args: {
        hasWorkspace: true,
        runtimeDefinitions: [SECOND_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR],
        isLoadingRuntimeDefinitions: false,
        runtimeDefinitionsError: null,
        runtimeHealthByRuntime: {
          opencode: makeRepoHealth({
            status: "checking",
            runtime: {
              status: "ready",
              stage: "runtime_ready",
              observation: null,
              instance: null,
              startedAt: null,
              updatedAt: "2026-02-20T12:01:00.000Z",
              elapsedMs: null,
              attempts: null,
              detail: null,
              failureKind: null,
              failureReason: null,
            },
            mcp: {
              supported: true,
              status: "checking",
              serverName: "openducktor",
              serverStatus: null,
              toolIds: [],
              detail: "Checking OpenDucktor MCP",
              failureKind: null,
            },
          }),
        },
        isLoadingChecks: false,
        refreshChecks: async () => {},
      },
    });

    try {
      await harness.mount();
      if (!latest) {
        throw new Error("Expected readiness hook to mount");
      }

      const readiness = latest as ReturnType<typeof useRepoRuntimeReadiness>;
      expect(readiness.state).toBe("checking");
      expect(readiness.message).toContain("Checking OpenDucktor MCP");
      expect(readiness.message).not.toContain("mock runtime failed");
    } finally {
      await harness.unmount();
    }
  });

  test("transitions to ready after transient runtime health settles", async () => {
    let latest: ReturnType<typeof useRepoRuntimeReadiness> | null = null;
    const checkingHealth = makeRepoHealth({
      status: "checking",
      runtime: {
        status: "ready",
        stage: "runtime_ready",
        observation: "observed_existing_runtime",
      },
      mcp: {
        supported: true,
        status: "checking",
        serverName: "openducktor",
        serverStatus: null,
        toolIds: [],
        detail: "Checking OpenDucktor MCP",
        failureKind: null,
      },
    });
    const readyHealth = makeRepoHealth();

    const Harness = ({ args }: { args: Parameters<typeof useRepoRuntimeReadiness>[0] }) => {
      latest = useRepoRuntimeReadiness(args);
      return null;
    };

    const baseArgs: Parameters<typeof useRepoRuntimeReadiness>[0] = {
      hasWorkspace: true,
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeHealthByRuntime: { opencode: checkingHealth },
      isLoadingChecks: false,
      refreshChecks: async () => {},
    };
    const harness = createSharedHookHarness(Harness, { args: baseArgs });

    try {
      await harness.mount();
      if (!latest) {
        throw new Error("Expected readiness hook to mount");
      }
      const checkingReadiness = latest as ReturnType<typeof useRepoRuntimeReadiness>;
      expect(checkingReadiness.state).toBe("checking");
      expect(checkingReadiness.message).toContain("Checking OpenDucktor MCP");

      await harness.update({
        args: {
          ...baseArgs,
          runtimeHealthByRuntime: { opencode: readyHealth },
        },
      });

      if (!latest) {
        throw new Error("Expected readiness hook to mount");
      }

      const readiness = latest as ReturnType<typeof useRepoRuntimeReadiness>;

      expect(readiness.state).toBe("ready");
      expect(readiness.message).toBeNull();
    } finally {
      await harness.unmount();
    }
  });
});

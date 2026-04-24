import { describe, expect, test } from "bun:test";
import {
  type BeadsCheck,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeCheck,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import type { DiagnosticsToastApi } from "@/state/operations/workspace/use-check-diagnostics-effects";
import { useChecks } from "@/state/operations/workspace/use-checks";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createBeadsCheckFixture,
  createRepoRuntimeHealthFixture,
  type RepoRuntimeHealthFixtureOverrides,
} from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useAgentStudioReadiness } from "./use-agents-page-readiness";

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

const makeRepoHealth = (
  overrides: RepoRuntimeHealthFixtureOverrides = {},
): RepoRuntimeHealthCheck =>
  createRepoRuntimeHealthFixture({ checkedAt: "2026-02-20T12:01:00.000Z" }, overrides);

const testToastApi: DiagnosticsToastApi = {
  error: () => undefined,
  dismiss: () => undefined,
};

const SECOND_RUNTIME_DESCRIPTOR: RuntimeDescriptor = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  kind: "mock-runtime",
  label: "Mock Runtime",
};

describe("useAgentStudioReadiness", () => {
  test("returns timeout-specific blocked copy while runtime health is warming up", async () => {
    let latest: ReturnType<typeof useAgentStudioReadiness> | null = null;

    const Harness = ({ args }: { args: Parameters<typeof useAgentStudioReadiness>[0] }) => {
      latest = useAgentStudioReadiness(args);
      return null;
    };

    const harness = createSharedHookHarness(Harness, {
      args: {
        activeWorkspace: createActiveWorkspace("/repo"),
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

      const readiness = latest as ReturnType<typeof useAgentStudioReadiness>;
      expect(readiness.agentStudioReadinessState).toBe("checking");
      expect(readiness.agentStudioBlockedReason).toContain("runtime is starting");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps MCP-stage copy when frontend times out during host MCP work", async () => {
    let latest: ReturnType<typeof useAgentStudioReadiness> | null = null;

    const Harness = ({ args }: { args: Parameters<typeof useAgentStudioReadiness>[0] }) => {
      latest = useAgentStudioReadiness(args);
      return null;
    };

    const harness = createSharedHookHarness(Harness, {
      args: {
        activeWorkspace: createActiveWorkspace("/repo"),
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

      const readiness = latest as ReturnType<typeof useAgentStudioReadiness>;
      expect(readiness.agentStudioBlockedReason).toContain("Checking OpenDucktor MCP");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps checking reason aligned with the runtime driving the global checking state", async () => {
    let latest: ReturnType<typeof useAgentStudioReadiness> | null = null;

    const Harness = ({ args }: { args: Parameters<typeof useAgentStudioReadiness>[0] }) => {
      latest = useAgentStudioReadiness(args);
      return null;
    };

    const harness = createSharedHookHarness(Harness, {
      args: {
        activeWorkspace: createActiveWorkspace("/repo"),
        runtimeDefinitions: [SECOND_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR],
        isLoadingRuntimeDefinitions: false,
        runtimeDefinitionsError: null,
        runtimeHealthByRuntime: {
          "mock-runtime": makeRepoHealth({
            status: "error",
            runtime: {
              status: "error",
              stage: "startup_failed",
              observation: null,
              instance: null,
              startedAt: null,
              updatedAt: "2026-02-20T12:01:00.000Z",
              elapsedMs: null,
              attempts: null,
              detail: "mock runtime failed",
              failureKind: "error",
              failureReason: null,
            },
          }),
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

      const readiness = latest as ReturnType<typeof useAgentStudioReadiness>;
      expect(readiness.agentStudioReadinessState).toBe("checking");
      expect(readiness.agentStudioBlockedReason).toContain("Checking OpenDucktor MCP");
      expect(readiness.agentStudioBlockedReason).not.toContain("mock runtime failed");
    } finally {
      await harness.unmount();
    }
  });

  test("transitions to ready after transient runtime health polling settles", async () => {
    let latest: ReturnType<typeof useAgentStudioReadiness> | null = null;
    let repoHealthCallCount = 0;
    const runtimeCheck = async (_force?: boolean): Promise<RuntimeCheck> => ({
      gitOk: true,
      gitVersion: "2.45.0",
      ghOk: true,
      ghVersion: "2.73.0",
      ghAuthOk: true,
      ghAuthLogin: "octocat",
      ghAuthError: null,
      runtimes: [{ kind: "opencode", ok: true, version: "0.12.0" }],
      errors: [],
    });
    const beadsCheck = async (): Promise<BeadsCheck> => createBeadsCheckFixture();

    const checkRepoRuntimeHealth = async (): Promise<RepoRuntimeHealthCheck> => {
      repoHealthCallCount += 1;
      if (repoHealthCallCount === 1) {
        return makeRepoHealth({
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
      }

      return makeRepoHealth();
    };

    const Harness = () => {
      const checks = useChecks({
        activeWorkspace: createActiveWorkspace("/repo"),
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        checkRepoRuntimeHealth,
        runtimeCheck,
        beadsCheck,
        toastApi: testToastApi,
      });
      latest = useAgentStudioReadiness({
        activeWorkspace: createActiveWorkspace("/repo"),
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        isLoadingRuntimeDefinitions: false,
        runtimeDefinitionsError: null,
        runtimeHealthByRuntime: checks.activeRepoRuntimeHealthByRuntime,
        isLoadingChecks: checks.isLoadingChecks,
        refreshChecks: checks.refreshChecks,
      });
      return null;
    };

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryProvider useIsolatedClient>{children}</QueryProvider>
    );

    const harness = createSharedHookHarness(Harness, {}, { wrapper });

    try {
      await harness.mount();
      await harness.waitFor(
        () =>
          latest?.agentStudioReadinessState === "checking" &&
          latest.agentStudioBlockedReason?.includes("Checking OpenDucktor MCP") === true,
      );
      await harness.waitFor(() => latest?.agentStudioReadinessState === "ready", 5000);
      if (!latest) {
        throw new Error("Expected readiness hook to mount");
      }

      const readiness = latest as ReturnType<typeof useAgentStudioReadiness>;

      expect(repoHealthCallCount).toBe(2);
      expect(readiness.agentStudioReady).toBe(true);
      expect(readiness.agentStudioBlockedReason).toBeNull();
    } finally {
      await harness.unmount();
    }
  }, 5000);
});

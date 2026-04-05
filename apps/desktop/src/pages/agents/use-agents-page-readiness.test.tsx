import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { useAgentStudioReadiness } from "./use-agents-page-readiness";

const makeRepoHealth = (
  overrides: Partial<RepoRuntimeHealthCheck> = {},
): RepoRuntimeHealthCheck => ({
  status: "ready",
  checkedAt: "2026-02-20T12:01:00.000Z",
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
    status: "connected",
    serverName: "openducktor",
    serverStatus: "connected",
    toolIds: [],
    detail: null,
    failureKind: null,
  },
  ...overrides,
});

describe("useAgentStudioReadiness", () => {
  test("returns timeout-specific blocked copy while runtime health is warming up", async () => {
    let latest: ReturnType<typeof useAgentStudioReadiness> | null = null;

    const Harness = ({ args }: { args: Parameters<typeof useAgentStudioReadiness>[0] }) => {
      latest = useAgentStudioReadiness(args);
      return null;
    };

    const harness = createSharedHookHarness(Harness, {
      args: {
        activeRepo: "/repo",
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
        activeRepo: "/repo",
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
});

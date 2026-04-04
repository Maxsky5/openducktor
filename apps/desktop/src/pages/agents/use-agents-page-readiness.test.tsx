import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useAgentStudioReadiness } from "./use-agents-page-readiness";

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
          opencode: {
            runtimeOk: false,
            runtimeError: "Timed out waiting for OpenCode runtime startup readiness",
            runtimeFailureKind: "timeout",
            runtime: null,
            mcpOk: false,
            mcpError: "Runtime is unavailable, so MCP cannot be verified.",
            mcpFailureKind: "timeout",
            mcpServerName: "openducktor",
            mcpServerStatus: null,
            mcpServerError: "Runtime is unavailable, so MCP cannot be verified.",
            availableToolIds: [],
            checkedAt: "2026-02-20T12:01:00.000Z",
            errors: ["Timed out waiting for OpenCode runtime startup readiness"],
            progress: {
              stage: "waiting_for_runtime",
              observation: "started_by_diagnostics",
              startedAt: "2026-02-20T12:00:55.000Z",
              updatedAt: "2026-02-20T12:01:00.000Z",
              elapsedMs: 5000,
              attempts: 4,
              detail: null,
              failureKind: "timeout",
              failureReason: null,
              failureOrigin: "frontend_observation",
              host: {
                runtimeKind: "opencode",
                repoPath: "/repo",
                stage: "waiting_for_runtime",
                runtime: null,
                startedAt: "2026-02-20T12:00:55.000Z",
                updatedAt: "2026-02-20T12:01:00.000Z",
                elapsedMs: 5000,
                attempts: 4,
                failureKind: null,
                failureReason: null,
                detail: null,
              },
            },
          },
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
      expect(readiness.agentStudioReadinessState).toBe("blocked");
      expect(readiness.agentStudioBlockedReason).toContain("Frontend diagnostics timed out");
      expect(readiness.agentStudioBlockedReason).toContain("local reachability");
    } finally {
      await harness.unmount();
    }
  });
});

import { describe, expect, test } from "bun:test";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import {
  classifyRepoRuntimeHealth,
  deriveRepoRuntimeHealthState,
  describeRepoRuntimeStatus,
  getRepoRuntimeBadge,
  isRepoRuntimeHealthBlockingReadiness,
  isRepoRuntimeHealthPendingReadiness,
  isRepoRuntimeReady,
  isRepoRuntimeStarting,
  isRepoRuntimeStartupPending,
} from "./repo-runtime-health";

describe("repo runtime health", () => {
  test("reports startup stages as runtime starting", () => {
    expect(
      isRepoRuntimeStarting(
        createRepoRuntimeHealthFixture({
          status: "checking",
          runtime: {
            status: "checking",
            stage: "startup_requested",
          },
        }),
      ),
    ).toBe(true);
    expect(
      isRepoRuntimeStarting(
        createRepoRuntimeHealthFixture({
          status: "checking",
          runtime: {
            status: "checking",
            stage: "waiting_for_runtime",
          },
        }),
      ),
    ).toBe(true);
  });

  test("does not report MCP checks after runtime readiness as runtime starting", () => {
    expect(
      isRepoRuntimeStarting(
        createRepoRuntimeHealthFixture({
          status: "checking",
          runtime: {
            status: "ready",
            stage: "runtime_ready",
          },
          mcp: {
            status: "checking",
          },
        }),
      ),
    ).toBe(false);
  });

  test("keeps runtime running while MCP reconnecting keeps readiness pending", () => {
    const runtimeHealth = createRepoRuntimeHealthFixture({
      status: "checking",
      runtime: {
        status: "ready",
        stage: "runtime_ready",
      },
      mcp: {
        status: "reconnecting",
        detail: "The operation was aborted due to timeout",
        failureKind: "timeout",
      },
    });

    expect(classifyRepoRuntimeHealth(runtimeHealth)).toBe("checking");
    expect(isRepoRuntimeHealthPendingReadiness(runtimeHealth)).toBe(true);
    expect(getRepoRuntimeBadge(runtimeHealth)).toEqual({
      label: "Running",
      variant: "success",
    });
    expect(describeRepoRuntimeStatus("OpenCode", runtimeHealth)).toBe(
      "Reconnecting OpenDucktor MCP for OpenCode.",
    );
  });

  test("derives aggregate health from MCP status once the runtime is ready", () => {
    const runtimeHealth = createRepoRuntimeHealthFixture({
      runtime: {
        status: "ready",
        stage: "runtime_ready",
      },
      mcp: {
        status: "reconnecting",
        detail: "The operation was aborted due to timeout",
        failureKind: "timeout",
      },
    });

    expect(deriveRepoRuntimeHealthState(runtimeHealth)).toBe("checking");
  });

  test("does not let a stale ready summary hide reconnecting MCP readiness", () => {
    const runtimeHealth = createRepoRuntimeHealthFixture({
      status: "ready",
      runtime: {
        status: "ready",
        stage: "runtime_ready",
      },
      mcp: {
        status: "reconnecting",
        detail: "The operation was aborted due to timeout",
        failureKind: "timeout",
      },
    });

    expect(isRepoRuntimeReady(runtimeHealth)).toBe(false);
    expect(classifyRepoRuntimeHealth(runtimeHealth)).toBe("checking");
    expect(isRepoRuntimeHealthPendingReadiness(runtimeHealth)).toBe(true);
    expect(isRepoRuntimeHealthBlockingReadiness(runtimeHealth)).toBe(false);
  });

  test("does not let a stale ready summary hide MCP failures", () => {
    const runtimeHealth = createRepoRuntimeHealthFixture({
      status: "ready",
      runtime: {
        status: "ready",
        stage: "runtime_ready",
      },
      mcp: {
        status: "error",
        detail: "MCP unavailable",
        failureKind: "error",
      },
    });

    expect(isRepoRuntimeReady(runtimeHealth)).toBe(false);
    expect(classifyRepoRuntimeHealth(runtimeHealth)).toBe("blocked");
    expect(isRepoRuntimeHealthBlockingReadiness(runtimeHealth)).toBe(true);
    expect(describeRepoRuntimeStatus("OpenCode", runtimeHealth)).toBe("MCP unavailable");
  });

  test("does not report idle runtimes as starting just because MCP is waiting", () => {
    const runtimeHealth = createRepoRuntimeHealthFixture({
      status: "not_started",
      runtime: {
        status: "not_started",
        stage: "idle",
      },
      mcp: {
        status: "waiting_for_runtime",
      },
    });

    expect(isRepoRuntimeStarting(runtimeHealth)).toBe(false);
    expect(isRepoRuntimeStartupPending(runtimeHealth)).toBe(true);
    expect(classifyRepoRuntimeHealth(runtimeHealth)).toBe("startup_pending");
  });

  test("projects not-started runtime health as startup pending", () => {
    const runtimeHealth = createRepoRuntimeHealthFixture({
      status: "not_started",
      runtime: {
        status: "not_started",
        stage: "idle",
        detail: "Runtime has not been started yet.",
      },
      mcp: {
        status: "waiting_for_runtime",
      },
    });

    expect(getRepoRuntimeBadge(runtimeHealth)).toEqual({
      label: "Starting",
      variant: "warning",
    });
    expect(classifyRepoRuntimeHealth(runtimeHealth)).toBe("startup_pending");
    expect(isRepoRuntimeHealthPendingReadiness(runtimeHealth)).toBe(true);
    expect(describeRepoRuntimeStatus("OpenCode", runtimeHealth)).toBe(
      "OpenCode runtime is starting.",
    );
  });

  test("keeps stale startup fields pending even when summary status is error", () => {
    const runtimeHealth = createRepoRuntimeHealthFixture({
      status: "error",
      runtime: {
        status: "not_started",
        stage: "idle",
        detail: "Runtime has not been started yet.",
        failureKind: "error",
      },
      mcp: {
        status: "waiting_for_runtime",
      },
    });

    expect(classifyRepoRuntimeHealth(runtimeHealth)).toBe("startup_pending");
    expect(getRepoRuntimeBadge(runtimeHealth)).toEqual({
      label: "Starting",
      variant: "warning",
    });
  });
});

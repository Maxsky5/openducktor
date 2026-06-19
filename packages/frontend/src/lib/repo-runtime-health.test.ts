import { describe, expect, test } from "bun:test";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import {
  classifyRepoRuntimeHealth,
  describeRepoRuntimeStatus,
  getRepoRuntimeBadge,
  isRepoRuntimeHealthPendingReadiness,
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

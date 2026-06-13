import { describe, expect, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import { deriveRepoRuntimeReadiness, isRepoRuntimeStarting } from "./repo-runtime-health";

const RUNTIME_DEFINITIONS = [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR];

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
    expect(
      isRepoRuntimeStarting(
        createRepoRuntimeHealthFixture({
          status: "not_started",
          runtime: {
            status: "not_started",
            stage: "idle",
          },
          mcp: {
            status: "waiting_for_runtime",
          },
        }),
      ),
    ).toBe(false);
  });

  test("derives repo readiness from any ready runtime when no runtime kind is selected", () => {
    const readiness = deriveRepoRuntimeReadiness({
      hasActiveWorkspace: true,
      runtimeDefinitions: RUNTIME_DEFINITIONS,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      isLoadingChecks: false,
      runtimeHealthByRuntime: {
        opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
        codex: createRepoRuntimeHealthFixture({
          status: "not_started",
          runtime: { status: "not_started", stage: "idle" },
        }),
      },
    });

    expect(readiness.readinessState).toBe("ready");
    expect(readiness.isReady).toBe(true);
  });

  test("derives selected-runtime readiness from the selected runtime only", () => {
    const readiness = deriveRepoRuntimeReadiness({
      hasActiveWorkspace: true,
      runtimeDefinitions: RUNTIME_DEFINITIONS,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      isLoadingChecks: false,
      runtimeKind: "codex",
      runtimeHealthByRuntime: {
        opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
        codex: createRepoRuntimeHealthFixture({
          status: "checking",
          runtime: { status: "checking", stage: "waiting_for_runtime" },
        }),
      },
    });

    expect(readiness.readinessState).toBe("checking");
    expect(readiness.isReady).toBe(false);
    expect(readiness.isRuntimeStarting).toBe(true);
  });
});

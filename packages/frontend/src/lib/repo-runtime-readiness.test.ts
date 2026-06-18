import { describe, expect, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import {
  deriveRepoRuntimeReadiness,
  inactiveRepoRuntimeReadinessTarget,
  repoRuntimeReadinessTargetForRuntime,
  resolvingRepoRuntimeReadinessTarget,
} from "./repo-runtime-readiness";

const RUNTIME_DEFINITIONS = [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR];

describe("repo runtime readiness", () => {
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

    expect(readiness.state).toBe("ready");
    expect(readiness.message).toBeNull();
  });

  test("derives selected-runtime readiness from the selected runtime only", () => {
    const readiness = deriveRepoRuntimeReadiness({
      hasActiveWorkspace: true,
      runtimeDefinitions: RUNTIME_DEFINITIONS,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      isLoadingChecks: false,
      runtimeTarget: repoRuntimeReadinessTargetForRuntime("codex"),
      runtimeHealthByRuntime: {
        opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
        codex: createRepoRuntimeHealthFixture({
          status: "checking",
          runtime: { status: "checking", stage: "waiting_for_runtime" },
        }),
      },
    });

    expect(readiness.state).toBe("checking");
    expect(readiness.message).toContain("Codex runtime is starting");
  });

  test("keeps selected-runtime readiness loading when automatic startup has not observed a runtime yet", () => {
    const readiness = deriveRepoRuntimeReadiness({
      hasActiveWorkspace: true,
      runtimeDefinitions: RUNTIME_DEFINITIONS,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      isLoadingChecks: false,
      runtimeTarget: repoRuntimeReadinessTargetForRuntime("codex"),
      runtimeHealthByRuntime: {
        codex: createRepoRuntimeHealthFixture({
          status: "not_started",
          runtime: {
            status: "not_started",
            stage: "idle",
            detail: "Runtime has not been started yet.",
          },
        }),
      },
    });

    expect(readiness.state).toBe("checking");
    expect(readiness.message).toBe("Codex runtime is starting...");
  });

  test("keeps readiness checking while the target runtime is still resolving", () => {
    const readiness = deriveRepoRuntimeReadiness({
      hasActiveWorkspace: true,
      runtimeDefinitions: RUNTIME_DEFINITIONS,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      isLoadingChecks: false,
      runtimeTarget: resolvingRepoRuntimeReadinessTarget,
      runtimeHealthByRuntime: {
        opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
        codex: createRepoRuntimeHealthFixture({ status: "ready" }),
      },
    });

    expect(readiness.state).toBe("checking");
    expect(readiness.message).toBe("Resolving selected agent runtime...");
  });

  test("treats inactive selections as having no runtime requirement", () => {
    const readiness = deriveRepoRuntimeReadiness({
      hasActiveWorkspace: true,
      runtimeDefinitions: RUNTIME_DEFINITIONS,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      isLoadingChecks: true,
      runtimeTarget: inactiveRepoRuntimeReadinessTarget,
      runtimeHealthByRuntime: {},
    });

    expect(readiness).toEqual({
      state: "ready",
      message: null,
      isLoadingChecks: true,
    });
  });

  test("keeps inactive selections scoped to an active workspace", () => {
    const readiness = deriveRepoRuntimeReadiness({
      hasActiveWorkspace: false,
      runtimeDefinitions: RUNTIME_DEFINITIONS,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      isLoadingChecks: false,
      runtimeTarget: inactiveRepoRuntimeReadinessTarget,
      runtimeHealthByRuntime: {},
    });

    expect(readiness).toEqual({
      state: "blocked",
      message: "Select a repository to use agent chat.",
      isLoadingChecks: false,
    });
  });
});

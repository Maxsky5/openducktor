import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import {
  buildBeadsCheckErrorState,
  buildDiagnosticsRetryPlan,
  buildDiagnosticsToastIssues,
  buildRuntimeCheckErrorState,
  buildRuntimeHealthErrorMap,
} from "./check-diagnostics";

const makeRepoHealth = (
  overrides: Partial<RepoRuntimeHealthCheck> = {},
): RepoRuntimeHealthCheck => ({
  runtimeOk: true,
  runtimeError: null,
  runtimeFailureKind: null,
  runtime: null,
  mcpOk: true,
  mcpError: null,
  mcpFailureKind: null,
  mcpServerName: "openducktor",
  mcpServerStatus: "connected",
  mcpServerError: null,
  availableToolIds: [],
  checkedAt: "2026-02-22T08:00:00.000Z",
  errors: [],
  ...overrides,
});

describe("check-diagnostics helpers", () => {
  test("projects runtime and beads query failures into concrete error states", () => {
    expect(
      buildRuntimeCheckErrorState([OPENCODE_RUNTIME_DESCRIPTOR], "Timed out after 15000ms"),
    ).toEqual(
      expect.objectContaining({
        gitOk: false,
        ghAuthError: "Timed out after 15000ms",
        runtimes: [{ kind: "opencode", ok: false, version: null }],
      }),
    );

    expect(buildBeadsCheckErrorState("beads offline")).toEqual({
      beadsOk: false,
      beadsPath: null,
      beadsError: "beads offline",
    });
  });

  test("builds toast issues across cli, beads, and runtime health checks", () => {
    const issues = buildDiagnosticsToastIssues({
      activeRepo: "/repo",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      runtimeCheckError: "Timed out after 15000ms",
      runtimeCheckFailureKind: "timeout",
      beadsCheckError: "beads offline",
      beadsCheckFailureKind: "error",
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtimeOk: false,
          runtimeError: "Timed out waiting for OpenCode runtime startup readiness",
          runtimeFailureKind: "timeout",
        }),
      },
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "diagnostics:cli-tools", severity: "timeout" }),
        expect.objectContaining({ id: "diagnostics:beads-store", severity: "error" }),
        expect.objectContaining({ id: "diagnostics:runtime:opencode", severity: "timeout" }),
      ]),
    );
  });

  test("computes retry plan per diagnostics family", () => {
    expect(
      buildDiagnosticsRetryPlan({
        activeRepo: "/repo",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeCheckFailureKind: "timeout",
        runtimeCheckFetching: false,
        beadsCheckFailureKind: "error",
        beadsCheckFetching: false,
        runtimeHealthByRuntime: buildRuntimeHealthErrorMap(
          [OPENCODE_RUNTIME_DESCRIPTOR],
          "runtime health failed",
          "2026-02-22T08:00:00.000Z",
        ),
        runtimeHealthFetching: false,
      }),
    ).toEqual({
      retryRuntimeCheck: true,
      retryBeadsCheck: false,
      retryRuntimeHealth: false,
    });

    expect(
      buildDiagnosticsRetryPlan({
        activeRepo: "/repo",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeCheckFailureKind: null,
        runtimeCheckFetching: false,
        beadsCheckFailureKind: "timeout",
        beadsCheckFetching: true,
        runtimeHealthByRuntime: {
          opencode: makeRepoHealth({
            mcpOk: false,
            mcpError: "OpenCode startup probe failed reason=timeout after 15000ms",
            mcpFailureKind: "timeout",
          }),
        },
        runtimeHealthFetching: false,
      }),
    ).toEqual({
      retryRuntimeCheck: false,
      retryBeadsCheck: false,
      retryRuntimeHealth: true,
    });
  });
});

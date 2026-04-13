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

type RepoHealthOverrides = Omit<Partial<RepoRuntimeHealthCheck>, "runtime" | "mcp"> & {
  runtime?: Partial<RepoRuntimeHealthCheck["runtime"]>;
  mcp?: Partial<NonNullable<RepoRuntimeHealthCheck["mcp"]>>;
};

const makeRepoHealth = (overrides: RepoHealthOverrides = {}): RepoRuntimeHealthCheck => {
  const checkedAt = overrides.checkedAt ?? "2026-02-22T08:00:00.000Z";
  const runtime: RepoRuntimeHealthCheck["runtime"] = {
    status: "ready",
    stage: "runtime_ready",
    observation: null,
    instance: null,
    startedAt: null,
    updatedAt: checkedAt,
    elapsedMs: null,
    attempts: null,
    detail: null,
    failureKind: null,
    failureReason: null,
    ...overrides.runtime,
  };
  const mcp: NonNullable<RepoRuntimeHealthCheck["mcp"]> = {
    supported: true,
    status: "connected",
    serverName: "openducktor",
    serverStatus: "connected",
    toolIds: [],
    detail: null,
    failureKind: null,
    ...overrides.mcp,
  };

  return {
    status:
      overrides.status ??
      (runtime.status === "error" || mcp.status === "error"
        ? "error"
        : mcp.status === "checking" ||
            mcp.status === "reconnecting" ||
            mcp.status === "waiting_for_runtime"
          ? "checking"
          : runtime.status),
    checkedAt,
    runtime,
    mcp,
  };
};

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
      repoStoreHealth: {
        category: "check_call_failed",
        status: "degraded",
        isReady: false,
        detail: "beads offline",
        attachment: {
          path: null,
          databaseName: null,
        },
        sharedServer: {
          host: null,
          port: null,
          ownershipState: "unavailable",
        },
      },
      beadsOk: false,
      beadsPath: null,
      beadsError: "beads offline",
    });
  });

  test("builds toast issues only for hard failures", () => {
    const issues = buildDiagnosticsToastIssues({
      activeRepo: "/repo",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      runtimeCheck: null,
      runtimeCheckError: "Timed out after 15000ms",
      runtimeCheckFailureKind: "timeout",
      beadsCheck: null,
      beadsCheckError: "beads offline",
      beadsCheckFailureKind: "error",
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "error",
          runtime: {
            status: "error",
            stage: "startup_failed",
            observation: null,
            instance: null,
            startedAt: null,
            updatedAt: "2026-02-22T08:00:00.000Z",
            elapsedMs: null,
            attempts: null,
            detail: "Timed out waiting for OpenCode runtime startup readiness",
            failureKind: "timeout",
            failureReason: null,
          },
        }),
      },
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "diagnostics:beads-store", severity: "error" }),
        expect.objectContaining({ id: "diagnostics:runtime:opencode", severity: "error" }),
      ]),
    );
    expect(issues).toHaveLength(2);
  });

  test("restores unhealthy cli and beads payload toasts even without query failures", () => {
    const issues = buildDiagnosticsToastIssues({
      activeRepo: "/repo",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      runtimeCheck: buildRuntimeCheckErrorState([OPENCODE_RUNTIME_DESCRIPTOR], "git missing"),
      runtimeCheckError: null,
      runtimeCheckFailureKind: null,
      beadsCheck: buildBeadsCheckErrorState("beads offline"),
      beadsCheckError: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {},
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "diagnostics:cli-tools",
          severity: "error",
          description: "git missing",
        }),
        expect.objectContaining({
          id: "diagnostics:beads-store",
          severity: "error",
          description: "beads offline",
        }),
      ]),
    );
  });

  test("treats GitHub CLI and auth failures as CLI toast-level issues", () => {
    const issues = buildDiagnosticsToastIssues({
      activeRepo: "/repo",
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: false,
        ghVersion: null,
        ghAuthOk: false,
        ghAuthLogin: null,
        ghAuthError: "gh auth missing",
        runtimes: [{ kind: "opencode", ok: true, version: "1.2.9" }],
        errors: ["gh auth missing"],
      },
      runtimeCheckError: null,
      runtimeCheckFailureKind: null,
      beadsCheck: null,
      beadsCheckError: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {},
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "diagnostics:cli-tools",
          severity: "error",
          description: "gh auth missing",
        }),
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
            status: "checking",
            mcp: {
              supported: true,
              status: "checking",
              serverName: "openducktor",
              serverStatus: null,
              toolIds: [],
              detail: "OpenCode startup probe failed reason=timeout after 15000ms",
              failureKind: "timeout",
            },
          }),
        },
        runtimeHealthFetching: false,
      }),
    ).toEqual({
      retryRuntimeCheck: false,
      retryBeadsCheck: false,
      retryRuntimeHealth: true,
    });

    expect(
      buildDiagnosticsRetryPlan({
        activeRepo: "/repo",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeCheckFailureKind: null,
        runtimeCheckFetching: false,
        beadsCheckFailureKind: null,
        beadsCheckFetching: false,
        runtimeHealthByRuntime: {
          opencode: makeRepoHealth({
            status: "checking",
            runtime: {
              status: "ready",
              stage: "runtime_ready",
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
        runtimeHealthFetching: false,
      }),
    ).toEqual({
      retryRuntimeCheck: false,
      retryBeadsCheck: false,
      retryRuntimeHealth: false,
    });

    expect(
      buildDiagnosticsRetryPlan({
        activeRepo: "/repo",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeCheckFailureKind: null,
        runtimeCheckFetching: false,
        beadsCheckFailureKind: null,
        beadsCheckFetching: false,
        runtimeHealthByRuntime: {
          opencode: makeRepoHealth({
            status: "error",
            mcp: {
              supported: true,
              status: "error",
              serverName: "openducktor",
              serverStatus: null,
              toolIds: [],
              detail: "OpenCode MCP timed out after retries",
              failureKind: "timeout",
            },
          }),
        },
        runtimeHealthFetching: false,
      }),
    ).toEqual({
      retryRuntimeCheck: false,
      retryBeadsCheck: false,
      retryRuntimeHealth: false,
    });
  });
});

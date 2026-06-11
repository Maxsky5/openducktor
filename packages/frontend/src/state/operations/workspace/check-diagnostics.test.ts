import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  createRepoRuntimeHealthFixture,
  type RepoRuntimeHealthFixtureOverrides,
} from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  buildDiagnosticsRetryPlan,
  buildDiagnosticsToastIssues,
  buildRuntimeCheckErrorState,
  buildRuntimeHealthErrorMap,
  buildTaskStoreCheckErrorState,
} from "./check-diagnostics";

const makeRepoHealth = (
  overrides: RepoRuntimeHealthFixtureOverrides = {},
): RepoRuntimeHealthCheck =>
  createRepoRuntimeHealthFixture({ checkedAt: "2026-02-22T08:00:00.000Z" }, overrides);

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

describe("check-diagnostics helpers", () => {
  test("projects runtime and task store query failures into concrete error states", () => {
    expect(
      buildRuntimeCheckErrorState([OPENCODE_RUNTIME_DESCRIPTOR], "Timed out after 15000ms"),
    ).toEqual(
      expect.objectContaining({
        gitOk: false,
        ghAuthError: "Timed out after 15000ms",
        runtimes: [
          expect.objectContaining({
            kind: "opencode",
            ok: false,
            version: null,
          }),
        ],
      }),
    );

    expect(buildTaskStoreCheckErrorState("task store offline")).toEqual({
      repoStoreHealth: {
        category: "check_call_failed",
        status: "degraded",
        isReady: false,
        detail: "task store offline",
        databasePath: null,
      },
      taskStoreOk: false,
      taskStorePath: null,
      taskStoreError: "task store offline",
    });
  });

  test("builds toast issues only for hard failures", () => {
    const issues = buildDiagnosticsToastIssues({
      activeWorkspace: createActiveWorkspace("/repo"),
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      runtimeCheck: null,
      runtimeCheckError: "Timed out after 15000ms",
      runtimeCheckFailureKind: "timeout",
      taskStoreCheck: null,
      taskStoreCheckError: "task store offline",
      taskStoreCheckFailureKind: "error",
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
        expect.objectContaining({ id: "diagnostics:task-store", severity: "error" }),
        expect.objectContaining({ id: "diagnostics:runtime:opencode", severity: "error" }),
      ]),
    );
    expect(issues).toHaveLength(2);
  });

  test("restores unhealthy cli and task-store payload toasts even without query failures", () => {
    const issues = buildDiagnosticsToastIssues({
      activeWorkspace: createActiveWorkspace("/repo"),
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      runtimeCheck: buildRuntimeCheckErrorState([OPENCODE_RUNTIME_DESCRIPTOR], "git missing"),
      runtimeCheckError: null,
      runtimeCheckFailureKind: null,
      taskStoreCheck: buildTaskStoreCheckErrorState("task store offline"),
      taskStoreCheckError: null,
      taskStoreCheckFailureKind: null,
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
          id: "diagnostics:task-store",
          severity: "error",
          description: "task store offline",
        }),
      ]),
    );
  });

  test("treats GitHub CLI and auth failures as CLI toast-level issues", () => {
    const issues = buildDiagnosticsToastIssues({
      activeWorkspace: createActiveWorkspace("/repo"),
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
      taskStoreCheck: null,
      taskStoreCheckError: null,
      taskStoreCheckFailureKind: null,
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
        activeWorkspace: createActiveWorkspace("/repo"),
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeCheckFailureKind: "timeout",
        runtimeCheckFetching: false,
        taskStoreCheckFailureKind: "error",
        taskStoreCheckFetching: false,
        runtimeHealthByRuntime: buildRuntimeHealthErrorMap(
          [OPENCODE_RUNTIME_DESCRIPTOR],
          "runtime health failed",
          "2026-02-22T08:00:00.000Z",
        ),
        runtimeHealthFetching: false,
      }),
    ).toEqual({
      retryRuntimeCheck: true,
      retryTaskStoreCheck: false,
      retryRuntimeHealth: false,
    });

    expect(
      buildDiagnosticsRetryPlan({
        activeWorkspace: createActiveWorkspace("/repo"),
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeCheckFailureKind: null,
        runtimeCheckFetching: false,
        taskStoreCheckFailureKind: "timeout",
        taskStoreCheckFetching: true,
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
      retryTaskStoreCheck: false,
      retryRuntimeHealth: true,
    });

    expect(
      buildDiagnosticsRetryPlan({
        activeWorkspace: createActiveWorkspace("/repo"),
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeCheckFailureKind: null,
        runtimeCheckFetching: false,
        taskStoreCheckFailureKind: null,
        taskStoreCheckFetching: false,
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
      retryTaskStoreCheck: false,
      retryRuntimeHealth: false,
    });

    expect(
      buildDiagnosticsRetryPlan({
        activeWorkspace: createActiveWorkspace("/repo"),
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeCheckFailureKind: null,
        runtimeCheckFetching: false,
        taskStoreCheckFailureKind: null,
        taskStoreCheckFetching: false,
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
      retryTaskStoreCheck: false,
      retryRuntimeHealth: false,
    });
  });
});

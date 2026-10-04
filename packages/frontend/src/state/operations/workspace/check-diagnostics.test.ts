import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createObservedCheckFixture } from "@/test-utils/shared-test-fixtures";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  buildDiagnosticsToastIssues,
  buildRuntimeCheckErrorState,
  buildTaskStoreCheckErrorState,
} from "./check-diagnostics";

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
        pathOk: false,
        gitOk: false,
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
      runtimeCheck: createObservedCheckFixture({
        error: "Timed out after 15000ms",
        failureKind: "timeout",
      }),
      taskStoreCheck: createObservedCheckFixture({
        error: "task store offline",
        failureKind: "error",
      }),
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "diagnostics:task-store", severity: "error" }),
      ]),
    );
    expect(issues).toHaveLength(1);
  });

  test("restores unhealthy cli and task-store payload toasts even without query failures", () => {
    const issues = buildDiagnosticsToastIssues({
      activeWorkspace: createActiveWorkspace("/repo"),
      runtimeCheck: createObservedCheckFixture({
        data: buildRuntimeCheckErrorState([OPENCODE_RUNTIME_DESCRIPTOR], "git missing"),
      }),
      taskStoreCheck: createObservedCheckFixture({
        data: buildTaskStoreCheckErrorState("task store offline"),
      }),
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

  test("does not add a CLI issue when Git is healthy", () => {
    const issues = buildDiagnosticsToastIssues({
      activeWorkspace: createActiveWorkspace("/repo"),
      runtimeCheck: createObservedCheckFixture({
        data: {
          pathOk: true,
          gitOk: true,
          gitVersion: "git version 2.50.1",
          runtimes: [
            { kind: "opencode", ok: true, executablePath: "/bin/opencode", version: "1.2.9" },
          ],
          errors: [],
        },
      }),
      taskStoreCheck: createObservedCheckFixture(),
    });

    expect(issues).toEqual([]);
  });

  test("adds a CLI issue when PATH is unavailable and Git is healthy", () => {
    const pathError = "Failed to resolve PATH from interactive login shell /bin/zsh.";
    const issues = buildDiagnosticsToastIssues({
      activeWorkspace: createActiveWorkspace("/repo"),
      runtimeCheck: createObservedCheckFixture({
        data: {
          pathOk: false,
          gitOk: true,
          gitVersion: "git version 2.50.1",
          runtimes: [
            { kind: "opencode", ok: false, executablePath: null, version: null, error: null },
          ],
          errors: [pathError],
        },
      }),
      taskStoreCheck: createObservedCheckFixture(),
    });

    expect(issues).toContainEqual(
      expect.objectContaining({ id: "diagnostics:cli-tools", description: pathError }),
    );
  });
});

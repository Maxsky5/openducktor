import { describe, expect, test } from "bun:test";
import {
  createObservedCheckFixture,
  createTaskStoreCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import { buildDiagnosticsToastIssues } from "./check-diagnostics";

const healthy = () => ({
  activeWorkspace: { workspaceId: "repo", workspaceName: "Repo", repoPath: "/repo" },
  pathCheck: createObservedCheckFixture({ data: { ok: true, error: null } }),
  gitCheck: createObservedCheckFixture({
    data: { ok: true, executablePath: "/bin/git", version: "git version 2.50.1", error: null },
  }),
  taskStoreCheck: createObservedCheckFixture({ data: createTaskStoreCheckFixture() }),
});

describe("diagnostics toasts", () => {
  test("healthy reads and timeouts do not show failure toasts", () => {
    expect(buildDiagnosticsToastIssues(healthy())).toEqual([]);
    expect(
      buildDiagnosticsToastIssues({
        ...healthy(),
        pathCheck: createObservedCheckFixture({ error: "Timed out", failureKind: "timeout" }),
        gitCheck: createObservedCheckFixture({ error: "Timed out", failureKind: "timeout" }),
        taskStoreCheck: createObservedCheckFixture({ error: "Timed out", failureKind: "timeout" }),
      }),
    ).toEqual([]);
  });
  test("PATH failure leaves healthy Git out of the issues", () => {
    expect(
      buildDiagnosticsToastIssues({
        ...healthy(),
        pathCheck: createObservedCheckFixture({
          data: { ok: false, error: "Shell startup failed." },
        }),
      }),
    ).toEqual([
      {
        id: "diagnostics:path",
        title: "PATH unavailable",
        description: "Shell startup failed.",
        severity: "error",
      },
    ]);
  });
  test("Git and task store payload failures retain their own details", () => {
    const issues = buildDiagnosticsToastIssues({
      ...healthy(),
      gitCheck: createObservedCheckFixture({
        data: { ok: false, executablePath: null, version: null, error: "git missing" },
      }),
      taskStoreCheck: createObservedCheckFixture({
        data: createTaskStoreCheckFixture(
          {},
          {
            taskStoreOk: false,
            taskStoreError: "task store offline",
            repoStoreHealth: {
              category: "database_unavailable",
              status: "blocking",
              isReady: false,
              detail: "task store offline",
              databasePath: null,
            },
          },
        ),
      }),
    });
    expect(issues).toEqual([
      {
        id: "diagnostics:git",
        title: "Git unavailable",
        description: "git missing",
        severity: "error",
      },
      {
        id: "diagnostics:task-store",
        title: "Task store unavailable",
        description: "task store offline",
        severity: "error",
      },
    ]);
  });
  test("unreadable checks report a read failure instead of an unavailable tool", () => {
    const issues = buildDiagnosticsToastIssues({
      ...healthy(),
      gitCheck: createObservedCheckFixture({ error: "IPC disconnected", failureKind: "error" }),
      taskStoreCheck: createObservedCheckFixture({
        error: "Store read failed",
        failureKind: "error",
      }),
    });
    expect(issues.map(({ title }) => title)).toEqual([
      "Git check unavailable",
      "Task store check unavailable",
    ]);
  });
});

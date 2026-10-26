import { describe, expect, test } from "bun:test";
import {
  buildNewWorkspaceSessionHref,
  buildSessionNavigationHref,
  buildSessionsPageHref,
  parseSessionsPageKind,
} from "./sessions-route";

const identity = {
  externalSessionId: "native",
  runtimeKind: "claude",
  workingDirectory: "/repo/worktrees/task-1",
} as const;

describe("Sessions page addresses", () => {
  test("names the workspace, task, native session ID, and role of a task session", () => {
    const href = buildSessionNavigationHref({
      kind: "task_session",
      workspaceId: "workspace-1",
      taskId: "task-1",
      role: "qa",
      identity,
    });

    expect(href).toBe(
      "/sessions?workspace=workspace-1&kind=task&task=task-1&session=native&agent=qa",
    );
  });

  test("opens a task context without a session or an invented role", () => {
    expect(
      buildSessionNavigationHref({ kind: "task", workspaceId: "w", taskId: "t", role: null }),
    ).toBe("/sessions?workspace=w&kind=task&task=t");
    expect(
      buildSessionNavigationHref({ kind: "task", workspaceId: "w", taskId: "t", role: "build" }),
    ).toBe("/sessions?workspace=w&kind=task&task=t&agent=build");
  });

  test("uses the saved record ID for a workspace session", () => {
    expect(
      buildSessionNavigationHref({
        kind: "workspace_session",
        workspaceId: "w",
        sessionId: "chat 1",
      }),
    ).toBe("/sessions?workspace=w&kind=workspace&session=chat+1");
    expect(buildNewWorkspaceSessionHref("w")).toBe(
      "/sessions?workspace=w&kind=workspace&create=session",
    );
  });

  test("builds a page address with or without a content kind", () => {
    expect(buildSessionsPageHref("w", null)).toBe("/sessions?workspace=w");
    expect(buildSessionsPageHref("w", "task")).toBe("/sessions?workspace=w&kind=task");
  });

  test("accepts only the known content kinds", () => {
    expect(parseSessionsPageKind("task")).toBe("task");
    expect(parseSessionsPageKind("workspace")).toBe("workspace");
    expect(parseSessionsPageKind("chats")).toBeNull();
    expect(parseSessionsPageKind(null)).toBeNull();
  });
});

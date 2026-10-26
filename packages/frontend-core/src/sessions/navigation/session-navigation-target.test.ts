import { describe, expect, test } from "bun:test";
import {
  type SessionNavigationTarget,
  sessionNavigationTargetKey,
} from "./session-navigation-target";

const identity = {
  externalSessionId: "native",
  runtimeKind: "claude",
  workingDirectory: "/repo/worktrees/task-1",
} as const;

describe("session navigation targets", () => {
  test("gives an entry and the content on screen the same key", () => {
    const sessionTarget: SessionNavigationTarget = {
      kind: "task_session",
      workspaceId: "w",
      taskId: "t",
      role: "build",
      identity,
    };

    expect(sessionNavigationTargetKey(sessionTarget)).toBe(
      sessionNavigationTargetKey({ ...sessionTarget, identity: { ...identity } }),
    );
    expect(
      sessionNavigationTargetKey({ kind: "task", workspaceId: "w", taskId: "t", role: null }),
    ).toBe(sessionNavigationTargetKey({ kind: "task", workspaceId: "w", taskId: "t", role: "qa" }));
    expect(sessionNavigationTargetKey(sessionTarget)).not.toBe(
      sessionNavigationTargetKey({ ...sessionTarget, workspaceId: "other" }),
    );
  });
});

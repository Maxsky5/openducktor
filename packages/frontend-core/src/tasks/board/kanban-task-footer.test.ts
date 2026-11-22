import { describe, expect, test } from "bun:test";
import type { KanbanTaskSession } from "./kanban-task-activity";
import { kanbanCardSessionTone } from "./kanban-task-footer";

const session = (
  externalSessionId: string,
  overrides: Partial<KanbanTaskSession> = {},
): KanbanTaskSession => ({
  externalSessionId,
  runtimeKind: "claude",
  workingDirectory: "/repo/worktrees/build",
  role: "build",
  activityState: "running",
  statusUnavailableReason: null,
  waitingOnBackground: false,
  ...overrides,
});

describe("kanbanCardSessionTone", () => {
  test("has no tone without an active session", () => {
    expect(kanbanCardSessionTone("idle", [session("a", { activityState: "idle" })])).toBeNull();
    expect(
      kanbanCardSessionTone("idle", [session("a", { statusUnavailableReason: "Stream lost" })]),
    ).toBeNull();
  });

  test("shows Background only when every active session waits on background tasks", () => {
    const waiting = session("a", { waitingOnBackground: true });
    expect(kanbanCardSessionTone("active", [waiting])).toBe("background");
    expect(kanbanCardSessionTone("active", [waiting, session("b")])).toBe("running");
  });

  test("keeps the input cue of a task that waits for input", () => {
    expect(
      kanbanCardSessionTone("waiting_input", [session("a", { activityState: "waiting_input" })]),
    ).toBe("waiting_input");
  });
});

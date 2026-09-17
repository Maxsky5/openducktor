import { describe, expect, test } from "bun:test";
import {
  foldWorkspaceActivityBadges,
  type WorkspaceActivitySession,
} from "./workspace-activity-state";

const session = (
  key: string,
  overrides: Partial<WorkspaceActivitySession> = {},
): WorkspaceActivitySession => ({
  key,
  parentKey: null,
  status: "idle",
  runtimeStatusMessage: null,
  stopRequestedAt: null,
  pendingApprovals: [],
  pendingQuestions: [],
  ...overrides,
});

const fold = (sessions: WorkspaceActivitySession[], archived: string[] = []) =>
  foldWorkspaceActivityBadges(
    new Map(sessions.map((entry) => [entry.key, entry])),
    new Set(archived),
  );

describe("foldWorkspaceActivityBadges", () => {
  test("reports no badge for idle and stopped sessions", () => {
    expect(fold([session("a"), session("b", { status: "stopped" })])).toEqual({
      inputRequired: false,
      error: false,
      active: false,
    });
  });

  test("reports one badge per state without a count", () => {
    expect(
      fold([
        session("running-1", { status: "running" }),
        session("running-2", { status: "starting" }),
        session("waiting-1", { pendingApprovals: [{}] }),
        session("waiting-2", { pendingQuestions: [{}] }),
        session("failed-1", { status: "error" }),
        session("failed-2", { status: "error" }),
      ]),
    ).toEqual({ inputRequired: true, error: true, active: true });
  });

  test("treats a starting session as active", () => {
    expect(fold([session("a", { status: "starting" })])).toEqual({
      inputRequired: false,
      error: false,
      active: true,
    });
  });

  test("pending input wins over the session status", () => {
    expect(fold([session("a", { status: "running", pendingApprovals: [{}] })])).toEqual({
      inputRequired: true,
      error: false,
      active: false,
    });
  });

  test("skips archived sessions", () => {
    expect(fold([session("a", { status: "running" })], ["a"])).toEqual({
      inputRequired: false,
      error: false,
      active: false,
    });
  });

  test("skips a live subagent of an archived chat", () => {
    expect(
      fold([session("chat"), session("child", { parentKey: "chat", status: "running" })], ["chat"]),
    ).toEqual({ inputRequired: false, error: false, active: false });
  });

  test("skips a live subagent whose archived parent is not reported live", () => {
    expect(fold([session("child", { parentKey: "chat", status: "running" })], ["chat"])).toEqual({
      inputRequired: false,
      error: false,
      active: false,
    });
  });

  test("ignores a subagent status but keeps its pending input on the parent", () => {
    expect(
      fold([
        session("parent"),
        session("child", { parentKey: "parent", status: "error", pendingQuestions: [{}] }),
      ]),
    ).toEqual({ inputRequired: true, error: false, active: false });
  });

  test("counts a subagent whose parent is not reported", () => {
    expect(fold([session("orphan", { parentKey: "missing", status: "running" })])).toEqual({
      inputRequired: false,
      error: false,
      active: true,
    });
  });

  test("stops at a parent cycle instead of looping", () => {
    expect(
      fold([
        session("a", { parentKey: "b", status: "running" }),
        session("b", { parentKey: "a", status: "running" }),
      ]),
    ).toEqual({ inputRequired: false, error: false, active: false });
  });
});

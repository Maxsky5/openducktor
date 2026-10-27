import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import {
  resolveTaskDetailsActions,
  taskDetailsMenuChoice,
  taskDetailsMenuItems,
  taskDocumentsSummary,
  taskTargetBranchPresentation,
} from "./task-details-model";

describe("resolveTaskDetailsActions", () => {
  test("offers Close Task in task details with the host actions", () => {
    const actions = resolveTaskDetailsActions({
      task: createTaskCardFixture({
        status: "in_progress",
        availableActions: ["build_start", "reset_implementation", "reset_task", "close_task"],
      }),
      taskSessions: [],
      historicalSessions: [],
      activeSessionRole: undefined,
      canRemoveWorktree: false,
    });
    expect(actions.primary?.label).toBe("Start Builder");
    expect(actions.others.map((action) => action.label)).toEqual([
      "Reset Implementation",
      "Reset Task",
      "Close Task",
    ]);
    expect(actions.others.find((action) => action.action === "close_task")?.tone).toBe("warning");
  });

  test("disables Open Builder until the view finds the Builder session", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      availableActions: ["open_builder", "reset_task"],
    });
    const builder: AgentSessionRecord = {
      externalSessionId: "build-1",
      role: "build",
      startedAt: "2026-10-02T10:00:00.000Z",
      runtimeKind: "opencode",
      workingDirectory: "/wt/task-1",
      selectedModel: null,
    };
    const all = (historicalSessions: AgentSessionRecord[]) => {
      const actions = resolveTaskDetailsActions({
        task,
        taskSessions: [],
        historicalSessions,
        activeSessionRole: undefined,
        canRemoveWorktree: false,
      });
      return [actions.primary, ...actions.others].flatMap((action) =>
        action ? [[action.action, action.disabled]] : [],
      );
    };
    expect(all([])).toContainEqual(["open_builder", true]);
    expect(all([])).toContainEqual(["reset_task", false]);
    expect(all([builder])).toContainEqual(["open_builder", false]);
  });

  test("offers Remove Worktree only while the worktree or the task branch remains", () => {
    const task = createTaskCardFixture({ status: "closed", availableActions: ["remove_worktree"] });
    const resolve = (canRemoveWorktree: boolean) =>
      resolveTaskDetailsActions({
        task,
        taskSessions: [],
        historicalSessions: [],
        activeSessionRole: undefined,
        canRemoveWorktree,
      }).primary?.label ?? null;
    expect(resolve(true)).toBe("Remove Worktree");
    expect(resolve(false)).toBeNull();
  });

  test("shows no action that the host does not list", () => {
    const actions = resolveTaskDetailsActions({
      task: createTaskCardFixture({ status: "open", availableActions: [] }),
      taskSessions: [],
      historicalSessions: [],
      activeSessionRole: undefined,
      canRemoveWorktree: false,
    });
    expect(actions.primary).toBeNull();
    expect(actions.others).toEqual([]);
  });
});

describe("taskDetailsMenuItems", () => {
  const actions = resolveTaskDetailsActions({
    task: createTaskCardFixture({
      status: "in_progress",
      availableActions: ["build_start", "reset_task", "close_task"],
    }),
    taskSessions: [],
    historicalSessions: [],
    activeSessionRole: undefined,
    canRemoveWorktree: false,
  });

  test("lists the other workflow actions, Unlink PR, and Delete", () => {
    const items = taskDetailsMenuItems({
      actions,
      enabled: true,
      showUnlink: true,
      unlinking: false,
    });
    expect(items.map((item) => item.title)).toEqual([
      "Reset Task",
      "Close Task",
      "Unlink PR",
      "Delete Task",
    ]);
    expect(items.find((item) => item.title === "Reset Task")?.destructive).toBe(true);
    expect(items.find((item) => item.title === "Unlink PR")?.command).toBe(true);
    expect(items.find((item) => item.title === "Close Task")?.command).toBe(true);
    expect(items.at(-1)).toMatchObject({ id: "delete", destructive: true, command: true });
  });

  test("disables every item while the workspace of the task is not selected", () => {
    const items = taskDetailsMenuItems({
      actions,
      enabled: false,
      showUnlink: false,
      unlinking: false,
    });
    expect(items.every((item) => item.disabled)).toBe(true);
    expect(items.some((item) => item.id === "unlink_pull_request")).toBe(false);
  });

  test("maps each item ID back to its choice", () => {
    const items = taskDetailsMenuItems({
      actions,
      enabled: true,
      showUnlink: true,
      unlinking: true,
    });
    const choices = items.map((item) => taskDetailsMenuChoice(item.id, actions));
    expect(choices.map((choice) => choice?.kind)).toEqual([
      "action",
      "action",
      "unlink_pull_request",
      "delete",
    ]);
    expect(choices[0]).toMatchObject({ kind: "action", action: { action: "reset_task" } });
    expect(items.find((item) => item.id === "unlink_pull_request")).toMatchObject({
      title: "Unlinking PR",
      disabled: true,
    });
    expect(taskDetailsMenuChoice("action:build_start", actions)).toBeNull();
  });
});

describe("taskTargetBranchPresentation", () => {
  test("names the target branch of the task, or its error", () => {
    expect(
      taskTargetBranchPresentation({ targetBranch: { remote: "origin", branch: "release" } }),
    ).toEqual({ label: "origin/release", error: null });
    expect(
      taskTargetBranchPresentation({ targetBranch: undefined, targetBranchError: "Bad ref" }),
    ).toEqual({ label: "Invalid task target branch", error: "Bad ref" });
    expect(taskTargetBranchPresentation({ targetBranch: undefined })).toBeNull();
  });
});

describe("taskDocumentsSummary", () => {
  const summary = (spec: boolean, plan: boolean, qa: boolean) => {
    const base = createTaskCardFixture({}).artifactSummary;
    return {
      ...base,
      spec: { present: spec },
      plan: { present: plan },
      qaReport: { present: qa },
    };
  };

  test("names the documents that exist", () => {
    expect(taskDocumentsSummary(summary(false, false, false))).toBeNull();
    expect(taskDocumentsSummary(summary(true, false, false))).toBe("Spec");
    expect(taskDocumentsSummary(summary(true, true, false))).toBe("Spec and Plan");
    expect(taskDocumentsSummary(summary(true, true, true))).toBe("Spec, Plan and QA report");
  });
});

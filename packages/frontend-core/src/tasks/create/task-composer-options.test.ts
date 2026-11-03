import { describe, expect, test } from "bun:test";
import { builtinTaskWorkflow } from "@openducktor/workflows";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import {
  collectKnownLabels,
  defaultIssueType,
  issueTypeChoices,
  toComposerState,
  toPrioritySelectOptions,
} from "./task-composer-options";

describe("task composer options", () => {
  test("starts a new task as a normal priority task", () => {
    expect(toComposerState(null)).toEqual({
      issueType: "task",
      removeWorktreeOnClose: null,
      title: "",
      priority: 2,
      description: "",
      labels: [],
    });
  });

  test("copies the user fields of a task", () => {
    const task = createTaskCardFixture({
      issueType: "bug",
      removeWorktreeOnClose: null,
      title: "Fix login",
      priority: 0,
      description: "Steps",
      labels: ["auth"],
    });
    expect(toComposerState(task)).toEqual({
      issueType: "bug",
      removeWorktreeOnClose: null,
      title: "Fix login",
      priority: 0,
      description: "Steps",
      labels: ["auth"],
    });
  });

  test("lists each workspace label once in alphabetical order", () => {
    const tasks = [
      createTaskCardFixture({ id: "a", labels: ["ui", "api"] }),
      createTaskCardFixture({ id: "b", labels: ["api", "docs"] }),
    ];
    expect(collectKnownLabels(tasks)).toEqual(["api", "docs", "ui"]);
  });

  test("offers each issue type of the workflow", () => {
    expect(
      issueTypeChoices(builtinTaskWorkflow).map(({ value, label }) => ({ value, label })),
    ).toEqual([
      { value: "feature", label: "Feature" },
      { value: "bug", label: "Bug" },
      { value: "task", label: "Task" },
    ]);
    expect(defaultIssueType(builtinTaskWorkflow)).toBe("task");
    expect(issueTypeChoices(undefined)).toEqual([]);
  });

  test("labels each priority with its hint", () => {
    expect(toPrioritySelectOptions()[0]).toEqual({
      value: "0",
      label: "P0 · Critical",
      searchKeywords: ["critical", "priority-0"],
    });
  });
});

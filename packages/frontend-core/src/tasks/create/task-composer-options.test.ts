import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import {
  collectKnownLabels,
  ISSUE_TYPE_CHOICES,
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
    expect(ISSUE_TYPE_CHOICES.map((choice) => choice.value)).toEqual(["feature", "bug", "task"]);
  });

  test("labels each priority with its hint", () => {
    expect(toPrioritySelectOptions()[0]).toEqual({
      value: "0",
      label: "P0 · Critical",
      searchKeywords: ["critical", "priority-0"],
    });
  });
});

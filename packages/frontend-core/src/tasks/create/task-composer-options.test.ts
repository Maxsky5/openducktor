import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import {
  collectKnownLabels,
  ISSUE_TYPE_CHOICES,
  toComposerState,
  toPrioritySelectOptions,
} from "./task-composer-options";

describe("task composer options", () => {
  test("starts a new task as a normal priority task with AI review", () => {
    expect(toComposerState(null)).toEqual({
      issueType: "task",
      aiReviewEnabled: true,
      title: "",
      priority: 2,
      description: "",
      labels: [],
    });
  });

  test("copies the user fields of a task", () => {
    const task = createTaskCardFixture({
      issueType: "bug",
      aiReviewEnabled: false,
      title: "Fix login",
      priority: 0,
      description: "Steps",
      labels: ["auth"],
    });
    expect(toComposerState(task)).toEqual({
      issueType: "bug",
      aiReviewEnabled: false,
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

  test("offers epics only as a disabled choice", () => {
    expect(
      ISSUE_TYPE_CHOICES.filter((choice) => choice.disabled).map((choice) => choice.value),
    ).toEqual(["epic"]);
  });

  test("labels each priority with its hint", () => {
    expect(toPrioritySelectOptions()[0]).toEqual({
      value: "0",
      label: "P0 · Critical",
      searchKeywords: ["critical", "priority-0"],
    });
  });
});

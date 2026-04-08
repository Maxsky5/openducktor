import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import { buildTaskSelectorOptions } from "./task-selector";

const tasks: TaskCard[] = [
  createTaskCardFixture({
    id: "TASK-123",
    title: "Polish GPT-5.4 dropdown search",
    issueType: "bug",
    status: "open",
    priority: 1,
    labels: ["frontend", "search"],
  }),
  createTaskCardFixture({
    id: "TASK-999",
    title: "Refine agent studio layout",
    issueType: "feature",
    status: "open",
    priority: 2,
    labels: ["ux"],
  }),
];

describe("TaskSelector", () => {
  test("builds options that search only by title while keeping ids visible", () => {
    const options = buildTaskSelectorOptions(tasks, false, "Select task");

    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({
      value: "TASK-123",
      label: "TASK-123 · Polish GPT-5.4 dropdown search",
      searchText: "Polish GPT-5.4 dropdown search",
    });
    expect(options[1]).toEqual({
      value: "TASK-999",
      label: "TASK-999 · Refine agent studio layout",
      searchText: "Refine agent studio layout",
    });
  });

  test("prepends the empty option when requested", () => {
    const options = buildTaskSelectorOptions(tasks, true, "Select task");

    expect(options[0]).toEqual({
      value: "__none__",
      label: "Select task",
      searchText: "Select task",
    });
  });
});

import { describe, expect, test } from "bun:test";
import type { PlanSubtaskInput, TaskCard } from "./contracts";
import { EpicSubtaskReplacementService } from "./epic-subtask-replacement";

const makeTask = (input: {
  id: string;
  title: string;
  status: TaskCard["status"];
  issueType?: TaskCard["issueType"];
  parentId?: string;
}): TaskCard => {
  return {
    id: input.id,
    title: input.title,
    status: input.status,
    issueType: input.issueType ?? "task",
    aiReviewEnabled: true,
    ...(input.parentId ? { parentId: input.parentId } : {}),
  };
};

describe("EpicSubtaskReplacementService", () => {
  test("prepareReplacement rejects when refreshed subtasks contain active work", async () => {
    const service = new EpicSubtaskReplacementService({
      listTasks: async () => [
        makeTask({ id: "epic-1", title: "Epic", status: "spec_ready", issueType: "epic" }),
        makeTask({
          id: "sub-1",
          title: "In progress",
          status: "in_progress",
          parentId: "epic-1",
        }),
      ],
      createSubtask: async () => "unused",
      deleteTask: async () => {},
    });

    await expect(
      service.prepareReplacement(
        makeTask({ id: "epic-1", title: "Epic", status: "spec_ready", issueType: "epic" }),
        [{ title: "New subtask" }],
      ),
    ).rejects.toThrow("Cannot replace epic subtasks while active work exists");
  });

  test("applyReplacement deletes existing subtasks first and deduplicates by title key", async () => {
    const operations: string[] = [];
    const createInputs: Array<{ parentTaskId: string; subtask: PlanSubtaskInput }> = [];

    const service = new EpicSubtaskReplacementService({
      listTasks: async () => [],
      createSubtask: async (parentTaskId, subtask) => {
        operations.push(`create:${subtask.title}`);
        createInputs.push({ parentTaskId, subtask });
        return `${parentTaskId}-${createInputs.length}`;
      },
      deleteTask: async (taskId) => {
        operations.push(`delete:${taskId}`);
      },
    });

    const epic = makeTask({ id: "epic-1", title: "Epic", status: "spec_ready", issueType: "epic" });
    const createdIds = await service.applyReplacement(
      epic,
      [
        makeTask({ id: "legacy-1", title: "Legacy 1", status: "open", parentId: "epic-1" }),
        makeTask({ id: "legacy-2", title: "Legacy 2", status: "open", parentId: "epic-1" }),
      ],
      [{ title: "Build API" }, { title: "build api" }, { title: "Write tests" }],
    );

    expect(operations).toEqual([
      "delete:legacy-1",
      "delete:legacy-2",
      "create:Build API",
      "create:Write tests",
    ]);
    expect(createInputs).toEqual([
      { parentTaskId: "epic-1", subtask: { title: "Build API" } },
      { parentTaskId: "epic-1", subtask: { title: "Write tests" } },
    ]);
    expect(createdIds).toEqual(["epic-1-1", "epic-1-2"]);
  });
});

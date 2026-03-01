import type {} from "./bun-test";
import type { SetPlanInput, SetSpecInput } from "./task-client";
import * as taskClientModule from "./task-client";
import { TauriTaskClient } from "./task-client";

const acceptSetSpecInput = (_input: SetSpecInput): void => {};
const acceptSetPlanInput = (_input: SetPlanInput): void => {};

describe("task-client exports contract", () => {
  test("keeps class export as the runtime surface", () => {
    expect(Object.keys(taskClientModule)).toEqual(["TauriTaskClient"]);
    expect(taskClientModule.TauriTaskClient).toBe(TauriTaskClient);
  });

  test("keeps planner input types importable", () => {
    acceptSetSpecInput({
      taskId: "task-1",
      markdown: "# Spec",
      repoPath: "/repo",
    });

    acceptSetPlanInput({
      taskId: "task-1",
      markdown: "# Plan",
      repoPath: "/repo",
      subtasks: [{ title: "Subtask" }],
    });

    expect(typeof TauriTaskClient).toBe("function");
  });
});

import { describe, expect, test } from "./bun-test";
import { normalizeTodoList } from "./todo-normalizers";

describe("todo-normalizers", () => {
  test("normalizes aliases and fallback values", () => {
    const todos = normalizeTodoList([
      {
        content: "Implement auth",
        status: "active",
        priority: "high",
      },
      {
        text: "Write tests",
        completed: true,
        priority: "invalid",
      },
    ]);

    expect(todos).toEqual([
      {
        id: "todo:0",
        content: "Implement auth",
        status: "in_progress",
        priority: "high",
      },
      {
        id: "todo:1",
        content: "Write tests",
        status: "completed",
        priority: "medium",
      },
    ]);
  });

  test("returns empty list for non-array payload", () => {
    expect(normalizeTodoList({})).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { normalizeAgentSessionTodoList } from "@openducktor/core";
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

  test("matches shared core normalization behavior across payload variants", () => {
    const payload = [
      {
        todoId: "todo-a",
        title: "A",
        status: "in progress",
        priority: "HIGH",
      },
      {
        id: "todo-b",
        text: "B",
        status: "finished",
      },
      {
        content: "C",
        completed: false,
      },
      "string entries are ignored by adapter normalizer",
    ];

    expect(normalizeTodoList(payload)).toEqual(normalizeAgentSessionTodoList(payload));
  });
});

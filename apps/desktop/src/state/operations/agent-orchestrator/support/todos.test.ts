import { describe, expect, test } from "bun:test";
import {
  mergeTodoListPreservingOrder,
  parseTodosFromToolInput,
  parseTodosFromToolOutput,
} from "./todos";

describe("agent-orchestrator/support/todos", () => {
  test("parses todos from tool input and output", () => {
    const fromInput = parseTodosFromToolInput({
      todos: [
        "first",
        {
          id: "todo-2",
          content: "second",
          status: "done",
          priority: "high",
        },
      ],
    });
    const fromOutput = parseTodosFromToolOutput(
      JSON.stringify({
        todos: [
          {
            id: "todo-3",
            title: "third",
            completed: false,
          },
        ],
      }),
    );

    expect(fromInput?.[0]?.id).toBe("todo:0");
    expect(fromInput?.[1]?.status).toBe("completed");
    expect(fromOutput?.[0]?.content).toBe("third");
  });

  test("preserves existing order when merging", () => {
    const merged = mergeTodoListPreservingOrder(
      [
        { id: "a", content: "A", status: "pending", priority: "medium" },
        { id: "b", content: "B", status: "pending", priority: "medium" },
      ],
      [
        { id: "b", content: "B2", status: "in_progress", priority: "high" },
        { id: "c", content: "C", status: "pending", priority: "low" },
        { id: "a", content: "A2", status: "completed", priority: "medium" },
      ],
    );

    expect(merged.map((todo) => todo.id)).toEqual(["a", "b", "c"]);
  });
});

import { describe, expect, test } from "bun:test";
import {
  normalizeAgentSessionTodoItem,
  normalizeAgentSessionTodoList,
  normalizeAgentSessionTodoPriority,
  normalizeAgentSessionTodoStatus,
} from "./agent-session-todos";

describe("agent session todo normalizers", () => {
  test("normalizes status aliases and fallbacks", () => {
    expect(normalizeAgentSessionTodoStatus("active")).toBe("in_progress");
    expect(normalizeAgentSessionTodoStatus("in progress")).toBe("in_progress");
    expect(normalizeAgentSessionTodoStatus("finished")).toBe("completed");
    expect(normalizeAgentSessionTodoStatus("unknown")).toBe("pending");
    expect(normalizeAgentSessionTodoStatus(undefined)).toBe("pending");
  });

  test("normalizes priority aliases and fallbacks", () => {
    expect(normalizeAgentSessionTodoPriority(" high ")).toBe("high");
    expect(normalizeAgentSessionTodoPriority("invalid")).toBe("medium");
    expect(normalizeAgentSessionTodoPriority(undefined)).toBe("medium");
  });

  test("normalizes todo items and applies completed boolean precedence", () => {
    expect(
      normalizeAgentSessionTodoItem({
        todoId: "todo-a",
        title: "Write tests",
        status: "active",
        completed: true,
        priority: "invalid",
      }),
    ).toEqual({
      id: "todo-a",
      content: "Write tests",
      status: "completed",
      priority: "medium",
    });
  });

  test("normalizes todo list entries with optional string support", () => {
    const payload = [
      "first",
      {
        content: "second",
        status: "done",
        priority: "high",
      },
      {
        id: "   ",
        content: "missing id",
      },
    ];

    expect(normalizeAgentSessionTodoList(payload)).toEqual([
      {
        id: "todo:1",
        content: "second",
        status: "completed",
        priority: "high",
      },
      {
        id: "todo:2",
        content: "missing id",
        status: "pending",
        priority: "medium",
      },
    ]);

    expect(normalizeAgentSessionTodoList(payload, { allowStringEntries: true })).toEqual([
      {
        id: "todo:0",
        content: "first",
        status: "pending",
        priority: "medium",
      },
      {
        id: "todo:1",
        content: "second",
        status: "completed",
        priority: "high",
      },
      {
        id: "todo:2",
        content: "missing id",
        status: "pending",
        priority: "medium",
      },
    ]);
  });
});

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
        id: "todo-a",
        content: "Write tests",
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

  test("normalizes canonical todo list entries and drops invalid rows", () => {
    const payload = [
      {
        id: "todo:0",
        content: "second",
        status: "done",
        priority: "high",
      },
      {
        id: "   ",
        content: "missing id",
      },
      {
        id: "todo:2",
        content: "   ",
        status: "pending",
      },
    ];

    expect(normalizeAgentSessionTodoList(payload)).toEqual([
      {
        id: "todo:0",
        content: "second",
        status: "completed",
        priority: "high",
      },
    ]);
  });
});

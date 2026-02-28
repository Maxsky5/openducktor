import { describe, expect, test } from "bun:test";
import {
  parseAgentSessionTodoPayloadEntry,
  parseAgentSessionTodoPayloadList,
} from "./session-todo-parsing";

describe("session todo payload parsing", () => {
  test("parses known object aliases into canonical todo payload records", () => {
    expect(
      parseAgentSessionTodoPayloadEntry(
        {
          todoId: "todo-1",
          title: "Write tests",
          status: "active",
          priority: "high",
          completed: false,
        },
        "todo:fallback",
      ),
    ).toEqual({
      id: "todo-1",
      content: "Write tests",
      status: "active",
      priority: "high",
      completed: false,
    });
  });

  test("parses list payloads with fallback ids and optional string support", () => {
    const payload = [
      "first",
      {
        content: "second",
        status: "done",
      },
      {
        id: "   ",
        text: "",
      },
    ];

    expect(parseAgentSessionTodoPayloadList(payload)).toEqual([
      {
        id: "todo:1",
        content: "second",
        status: "done",
      },
    ]);

    expect(
      parseAgentSessionTodoPayloadList(payload, {
        allowStringEntries: true,
      }),
    ).toEqual([
      {
        id: "todo:0",
        content: "first",
      },
      {
        id: "todo:1",
        content: "second",
        status: "done",
      },
    ]);
  });

  test("returns empty list for non-array payloads", () => {
    expect(parseAgentSessionTodoPayloadList({})).toEqual([]);
  });
});

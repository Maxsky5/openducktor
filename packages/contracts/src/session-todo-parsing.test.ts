import { describe, expect, test } from "bun:test";
import { agentSessionTodoPayloadListSchema } from "./session-todo-parsing";

describe("session todo payload parsing", () => {
  test("parses known object aliases into canonical todo payload records", () => {
    expect(
      agentSessionTodoPayloadListSchema().parse([
        {
          todoId: "todo-1",
          title: "Write tests",
          status: "active",
          priority: "high",
          completed: false,
        },
      ]),
    ).toEqual([
      {
        id: "todo-1",
        content: "Write tests",
        status: "active",
        priority: "high",
        completed: false,
      },
    ]);
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

    expect(agentSessionTodoPayloadListSchema().parse(payload)).toEqual([
      {
        id: "todo:1",
        content: "second",
        status: "done",
      },
    ]);

    expect(
      agentSessionTodoPayloadListSchema({
        allowStringEntries: true,
      }).parse(payload),
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
    expect(agentSessionTodoPayloadListSchema().parse({})).toEqual([]);
  });

  test("keeps valid todo entries when sibling entries are malformed", () => {
    expect(
      agentSessionTodoPayloadListSchema().parse([
        { id: "todo-1", content: "Keep this todo" },
        { id: 2, content: "Reject this todo" },
        null,
      ]),
    ).toEqual([{ id: "todo-1", content: "Keep this todo" }]);
  });
});

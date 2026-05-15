import { describe, expect, test } from "bun:test";
import { projectCodexCanonicalEvents } from "./codex-canonical-projector";
import { todoMapper } from "./event-mappers";

const TODO_PAYLOAD = {
  explanation: "Tracking work",
  plan: [
    { id: "1", step: "Inspect", status: "completed" },
    { id: "2", step: "Refactor", status: "in_progress" },
  ],
};

const TODO_DISPLAY_INPUT = {
  explanation: "Tracking work",
  plan: [
    { step: "Inspect", status: "completed" },
    { step: "Refactor", status: "in_progress" },
  ],
};

const projectedTool = (events: ReturnType<typeof projectCodexCanonicalEvents>) =>
  events.find((event) => event.type === "assistant_part" && event.part.kind === "tool");

const projectedTodos = (events: ReturnType<typeof projectCodexCanonicalEvents>) =>
  events.find((event) => event.type === "session_todos_updated");

describe("Codex todo event mapper", () => {
  test("keeps live and thread-read todo updates in canonical parity", () => {
    const live = projectCodexCanonicalEvents(
      todoMapper.fromLivePlanUpdated(TODO_PAYLOAD, {
        source: "live",
        threadId: "thread-1",
        turnId: "turn-1",
        timestamp: "2026-05-09T00:00:00.000Z",
      }).events,
    );

    const threadRead = projectCodexCanonicalEvents(
      todoMapper.fromThreadItemObject(
        {
          type: "dynamicToolCall",
          id: "call-1",
          namespace: "functions",
          tool: "update_plan",
          arguments: TODO_PAYLOAD,
          status: "completed",
        },
        { source: "thread_read", threadId: "thread-1" },
      ).events,
    );

    for (const events of [live, threadRead]) {
      expect(projectedTool(events)).toEqual(
        expect.objectContaining({
          type: "assistant_part",
          part: expect.objectContaining({
            kind: "tool",
            tool: "update_plan",
            title: "update_plan",
            status: "completed",
            input: TODO_DISPLAY_INPUT,
            output: "Plan updated",
          }),
        }),
      );
      expect(projectedTodos(events)).toEqual(
        expect.objectContaining({
          type: "session_todos_updated",
          todos: [
            expect.objectContaining({ id: "1", content: "Inspect", status: "completed" }),
            expect.objectContaining({ id: "2", content: "Refactor", status: "in_progress" }),
          ],
        }),
      );
    }
  });
});

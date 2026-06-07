import { describe, expect, test } from "bun:test";
import { projectCodexCanonicalEvents } from "./codex-canonical-projector";
import { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import { projectCodexCanonicalEventsToHistory } from "./codex-history-projector";
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
  todos: [
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
            toolType: "todo",
            displayLabel: "todo",
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

  test("gives each live todo update a distinct tool call identity", () => {
    const pipeline = createCodexEventMapperPipeline();
    const first = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "notification",
          notification: {
            method: "turn/plan/updated",
            params: TODO_PAYLOAD,
          },
        },
        {
          source: "live",
          threadId: "thread-1",
          turnId: "turn-1",
          timestamp: "2026-05-09T00:00:00.000Z",
        },
      ),
    );
    const second = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "notification",
          notification: {
            method: "turn/plan/updated",
            params: {
              explanation: "Tracking work",
              plan: [
                { id: "1", step: "Inspect", status: "completed" },
                { id: "2", step: "Refactor", status: "completed" },
              ],
            },
          },
        },
        {
          source: "live",
          threadId: "thread-1",
          turnId: "turn-1",
          timestamp: "2026-05-09T00:00:00.000Z",
        },
      ),
    );

    const firstTool = projectedTool(first);
    const secondTool = projectedTool(second);
    if (firstTool?.type !== "assistant_part" || firstTool.part.kind !== "tool") {
      throw new Error("Expected first todo tool event");
    }
    if (secondTool?.type !== "assistant_part" || secondTool.part.kind !== "tool") {
      throw new Error("Expected second todo tool event");
    }

    expect(firstTool.part.partId).toBe("turn-1-update-plan-1");
    expect(firstTool.part.callId).toBe("turn-1-update-plan-1");
    expect(secondTool.part.partId).toBe("turn-1-update-plan-2");
    expect(secondTool.part.callId).toBe("turn-1-update-plan-2");
  });

  test("does not map thread-read todo updates with content item errors", () => {
    const result = todoMapper.fromThreadItemObject(
      {
        type: "dynamicToolCall",
        id: "call-1",
        namespace: "functions",
        tool: "update_plan",
        arguments: TODO_PAYLOAD,
        status: "completed",
        contentItems: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: { message: "Plan update failed" },
            }),
          },
        ],
      },
      { source: "thread_read", threadId: "thread-1" },
    );

    expect(result.handled).toBe(false);
    expect(result.events).toEqual([]);
  });

  test("does not map thread-read todo updates with result errors when content items exist", () => {
    const result = todoMapper.fromThreadItemObject(
      {
        type: "dynamicToolCall",
        id: "call-1",
        namespace: "functions",
        tool: "update_plan",
        arguments: TODO_PAYLOAD,
        status: "completed",
        contentItems: [{ type: "text", text: "Plan update output" }],
        result: {
          ok: false,
          error: { message: "Plan update failed" },
        },
      },
      { source: "thread_read", threadId: "thread-1" },
    );

    expect(result.handled).toBe(false);
    expect(result.events).toEqual([]);
  });
});

describe("Codex file change event mapper", () => {
  test("projects live patch updates to running file-change tool parts", () => {
    const pipeline = createCodexEventMapperPipeline();
    const events = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "notification",
          notification: {
            method: "item/fileChange/patchUpdated",
            params: {
              itemId: "patch-1",
              changes: [
                {
                  path: "src/new.ts",
                  kind: { type: "add" },
                  diff: "created\n",
                },
              ],
            },
          },
        },
        {
          source: "live",
          threadId: "thread-1",
          turnId: "turn-1",
          timestamp: "2026-05-09T00:00:00.000Z",
        },
      ),
    );

    expect(projectedTool(events)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "tool",
          tool: "apply_patch",
          toolType: "file_edit",
          status: "running",
          fileDiffs: [
            {
              file: "src/new.ts",
              type: "added",
              additions: 1,
              deletions: 0,
              diff: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,1 @@\n+created\n",
            },
          ],
        }),
      }),
    );
  });
});

describe("Codex compaction event mapper", () => {
  test("projects live context compaction starts to session events", () => {
    const pipeline = createCodexEventMapperPipeline();
    const events = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_started",
          item: {
            type: "contextCompaction",
            id: "compact-live",
          },
        },
        {
          source: "live",
          threadId: "thread-1",
          timestamp: "2026-05-18T21:00:00.000Z",
        },
      ),
    );

    expect(events).toEqual([
      {
        type: "session_compaction_started",
        externalSessionId: "thread-1",
        timestamp: "2026-05-18T21:00:00.000Z",
        messageId: "compact-live",
        message: "Session compaction started.",
      },
    ]);
  });

  test("projects live context compaction items to session events", () => {
    const pipeline = createCodexEventMapperPipeline();
    const events = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "contextCompaction",
            id: "compact-live",
          },
        },
        {
          source: "live",
          threadId: "thread-1",
          turnId: "turn-1",
          timestamp: "2026-05-18T21:00:00.000Z",
        },
      ),
    );

    expect(events).toEqual([
      {
        type: "session_compacted",
        externalSessionId: "thread-1",
        timestamp: "2026-05-18T21:00:00.000Z",
        messageId: "compact-live",
        message: "Session compacted.",
      },
    ]);
  });

  test("projects thread-read context compaction items to session notice history", () => {
    const pipeline = createCodexEventMapperPipeline();
    const result = pipeline.runThreadItemResult(
      {
        index: 3,
        timestamp: "2026-05-18T21:00:00.000Z",
        item: {
          type: "context_compaction",
          id: "compact-1",
        },
      },
      {
        source: "thread_read",
        threadId: "thread-1",
        timestamp: "2026-05-18T21:00:00.000Z",
      },
    );

    expect(projectCodexCanonicalEventsToHistory(result.events)).toEqual([
      {
        messageId: "compact-1",
        role: "system",
        timestamp: "2026-05-18T21:00:00.000Z",
        text: "Session compacted.",
        notice: {
          tone: "info",
          reason: "session_compacted",
          title: "Compacted",
        },
        parts: [],
      },
    ]);
  });

  test("does not map unknown notifications as compaction", () => {
    const pipeline = createCodexEventMapperPipeline();
    const result = pipeline.runLiveResult(
      {
        kind: "notification",
        notification: {
          method: "thread/status/changed",
          params: { status: "thinking" },
        },
      },
      {
        source: "live",
        threadId: "thread-1",
      },
    );

    expect(result).toEqual({ events: [], handled: false });
  });
});

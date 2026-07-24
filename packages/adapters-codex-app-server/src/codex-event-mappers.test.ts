import { describe, expect, test } from "bun:test";
import { projectCodexCanonicalEvents } from "./codex-canonical-projector";
import { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import { projectCodexCanonicalEventsToHistory } from "./codex-history-projector";
import { CodexSubagentLinkState } from "./codex-subagent-link-state";
import { createCodexEventMappers, todoMapper } from "./event-mappers";

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

const projectedSubagents = (events: ReturnType<typeof projectCodexCanonicalEvents>) =>
  events
    .filter((event) => event.type === "assistant_part" && event.part.kind === "subagent")
    .map((event) => {
      if (event.type !== "assistant_part" || event.part.kind !== "subagent") {
        throw new Error("Expected subagent part event");
      }
      return event.part;
    });

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

describe("Codex subagent event mapper", () => {
  test("merges live spawn begin and completed events into one linked subagent row", () => {
    const pipeline = createCodexEventMapperPipeline();
    const ctx = {
      source: "live" as const,
      threadId: "parent-thread",
      turnId: "turn-1",
      timestamp: "2026-05-09T00:00:00.000Z",
    };
    const started = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_started",
          item: {
            type: "collabAgentToolCall",
            id: "spawn-1",
            tool: "spawnAgent",
            status: "inProgress",
            senderThreadId: "parent-thread",
            receiverThreadIds: [],
            prompt: "Review the adapter",
            agentsStates: {},
          },
        },
        ctx,
      ),
    );
    const completed = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "spawn-1",
            tool: "spawnAgent",
            status: "completed",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread"],
            prompt: "Review the adapter",
            agentsStates: {
              "child-thread": { status: "running", message: null },
            },
          },
        },
        ctx,
      ),
    );

    const [startedPart] = projectedSubagents(started);
    const [completedPart] = projectedSubagents(completed);
    expect(startedPart).toMatchObject({
      kind: "subagent",
      correlationKey: "codex-subagent:parent-thread:spawn-1",
      status: "running",
      prompt: "Review the adapter",
      description: "Review the adapter",
    });
    expect(startedPart?.externalSessionId).toBeUndefined();
    expect(completedPart).toMatchObject({
      kind: "subagent",
      correlationKey: startedPart?.correlationKey,
      status: "running",
      externalSessionId: "child-thread",
      description: "Review the adapter",
    });
    expect(completedPart?.executionMode).toBeUndefined();
  });

  test("maps documented collabToolCall spawn fields to a linked subagent row", () => {
    const pipeline = createCodexEventMapperPipeline();
    const ctx = {
      source: "live" as const,
      threadId: "parent-thread",
      turnId: "turn-1",
      timestamp: "2026-05-09T00:00:00.000Z",
    };

    const started = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_started",
          item: {
            type: "collabToolCall",
            id: "spawn-1",
            tool: "spawnAgent",
            status: "inProgress",
            senderThreadId: "parent-thread",
            newThreadId: "child-thread",
            receiverThreadId: "child-thread",
            prompt: "Review the adapter",
            agentStatus: "running",
          },
        },
        ctx,
      ),
    );

    const [startedPart] = projectedSubagents(started);
    expect(startedPart).toMatchObject({
      kind: "subagent",
      correlationKey: "codex-subagent:parent-thread:spawn-1",
      status: "running",
      externalSessionId: "child-thread",
      prompt: "Review the adapter",
      description: "Review the adapter",
    });
  });

  test("keeps subagent description short and tied to the creation prompt", () => {
    const pipeline = createCodexEventMapperPipeline();
    const ctx = {
      source: "live" as const,
      threadId: "parent-thread",
      timestamp: "2026-05-09T00:00:00.000Z",
    };
    const prompt =
      "Read the file `~/maxsky5.omp.json` and report back the file contents or, if it is large, a concise summary of the key fields. This is read-only.";
    const fullResponse =
      "`/Users/maxsky5/maxsky5.omp.json` exists and is a Oh My Posh theme config.\n\nKey fields:\n- `$schema`: https://example.test/schema.json\n- `version`: 4";

    pipeline.runLive(
      {
        kind: "item_started",
        item: {
          type: "collabAgentToolCall",
          id: "spawn-1",
          tool: "spawnAgent",
          status: "inProgress",
          senderThreadId: "parent-thread",
          receiverThreadIds: [],
          prompt,
          agentsStates: {},
        },
      },
      ctx,
    );
    const completed = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "spawn-1",
            tool: "spawnAgent",
            status: "completed",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread"],
            prompt,
            agentsStates: {
              "child-thread": { status: "completed", message: fullResponse },
            },
          },
        },
        ctx,
      ),
    );

    const [completedPart] = projectedSubagents(completed);
    expect(completedPart).toMatchObject({
      status: "completed",
      prompt,
      externalSessionId: "child-thread",
    });
    expect(completedPart?.description).toBeDefined();
    expect(completedPart?.description?.length ?? 0).toBeLessThanOrEqual(140);
    expect(completedPart?.description?.startsWith("Read the file")).toBe(true);
    expect(completedPart?.description).not.toContain("Key fields");
  });

  test("marks failed provisional spawn rows as error without losing creation description", () => {
    const pipeline = createCodexEventMapperPipeline();
    const ctx = {
      source: "live" as const,
      threadId: "parent-thread",
      timestamp: "2026-05-09T00:00:00.000Z",
    };
    pipeline.runLive(
      {
        kind: "item_started",
        item: {
          type: "collabAgentToolCall",
          id: "spawn-1",
          tool: "spawnAgent",
          status: "inProgress",
          senderThreadId: "parent-thread",
          receiverThreadIds: [],
          prompt: "Inspect config safely",
          agentsStates: {},
        },
      },
      ctx,
    );

    const failed = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "spawn-1",
            tool: "spawnAgent",
            status: "failed",
            senderThreadId: "parent-thread",
            receiverThreadIds: [],
            prompt: "Inspect config safely",
            agentsStates: {},
          },
        },
        ctx,
      ),
    );

    expect(projectedSubagents(failed)).toEqual([
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:spawn-1",
        status: "error",
        description: "Inspect config safely",
        error: "Codex spawnAgent subagent call failed.",
      }),
    ]);
  });

  test("maps per-child agent states before aggregate collab status", () => {
    const pipeline = createCodexEventMapperPipeline();
    const events = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "wait-1",
            tool: "wait",
            status: "failed",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-ok", "child-failed"],
            prompt: null,
            agentsStates: {
              "child-ok": { status: "completed", message: null },
              "child-failed": { status: "errored", message: "Tests failed" },
            },
          },
        },
        {
          source: "live",
          threadId: "parent-thread",
          timestamp: "2026-05-09T00:00:00.000Z",
        },
      ),
    );

    expect(projectedSubagents(events)).toEqual([
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:child-ok",
        status: "completed",
        externalSessionId: "child-ok",
      }),
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:child-failed",
        status: "error",
        error: "Tests failed",
        externalSessionId: "child-failed",
      }),
    ]);
  });

  test("leaves receiverless wait collab items to the generic collab mapper", () => {
    const pipeline = createCodexEventMapperPipeline();
    const events = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_started",
          item: {
            type: "collabAgentToolCall",
            id: "wait-any",
            tool: "wait",
            status: "inProgress",
            senderThreadId: "parent-thread",
            receiverThreadIds: [],
            prompt: null,
            agentsStates: {},
          },
        },
        {
          source: "live",
          threadId: "parent-thread",
          timestamp: "2026-05-09T00:00:00.000Z",
        },
      ),
    );

    expect(projectedSubagents(events)).toEqual([]);
    expect(projectedTool(events)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "tool",
          tool: "collab.wait",
          status: "running",
        }),
      }),
    );
  });

  test("leaves null receiver wait collab items to the generic collab mapper", () => {
    const pipeline = createCodexEventMapperPipeline();
    const events = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_started",
          item: {
            type: "collabAgentToolCall",
            id: "wait-any",
            tool: "wait",
            status: "inProgress",
            senderThreadId: "parent-thread",
            receiverThreadIds: null,
            prompt: null,
            agentsStates: {},
          },
        },
        {
          source: "live",
          threadId: "parent-thread",
          timestamp: "2026-05-09T00:00:00.000Z",
        },
      ),
    );

    expect(projectedSubagents(events)).toEqual([]);
    expect(projectedTool(events)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "tool",
          tool: "collab.wait",
          status: "running",
        }),
      }),
    );
  });

  test("keeps interrupted Codex subagents resumable", () => {
    const pipeline = createCodexEventMapperPipeline();
    const ctx = {
      source: "live" as const,
      threadId: "parent-thread",
      timestamp: "2026-05-09T00:00:00.000Z",
    };
    const interruptedEvents = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "wait-1",
            tool: "wait",
            status: "completed",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread"],
            prompt: null,
            agentsStates: {
              "child-thread": { status: "interrupted", message: "Paused for input" },
            },
          },
        },
        ctx,
      ),
    );

    expect(projectedSubagents(interruptedEvents)).toEqual([
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:child-thread",
        status: "running",
        externalSessionId: "child-thread",
      }),
    ]);
    expect(projectedSubagents(interruptedEvents)[0]?.description).toBeUndefined();

    const resumedEvents = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "resume-1",
            tool: "resumeAgent",
            status: "completed",
            startedAtMs: 1_778_284_801_000,
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread"],
            prompt: null,
            agentsStates: {
              "child-thread": { status: "running", message: null },
            },
          },
        },
        ctx,
      ),
    );

    expect(projectedSubagents(resumedEvents)).toEqual([
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:child-thread",
        status: "running",
        externalSessionId: "child-thread",
        startedAtMs: 1_778_284_801_000,
      }),
    ]);
  });

  test("does not restart a completed V2 subagent for generic interacted activity", () => {
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "completed",
    });
    const pipeline = createCodexEventMapperPipeline(createCodexEventMappers(subagents));
    const ctx = {
      source: "live" as const,
      threadId: "parent-thread",
      timestamp: "2026-07-10T12:00:00.000Z",
    };
    const activity = (id: string, kind: "started" | "interacted") => ({
      type: "subAgentActivity",
      id,
      agentThreadId: "child-thread",
      agentPath: "/root/child",
      kind,
    });

    const interacted = projectCodexCanonicalEvents(
      pipeline.runLive({ kind: "item_completed", item: activity("message-1", "interacted") }, ctx),
    );

    expect(projectedSubagents(interacted)[0]).toMatchObject({ status: "completed" });
  });

  test("creates nested routes from live activity emitted by each owning thread", () => {
    const subagents = new CodexSubagentLinkState();
    const pipeline = createCodexEventMapperPipeline(createCodexEventMappers(subagents));
    const activity = (id: string, agentThreadId: string) => ({
      type: "subAgentActivity",
      id,
      agentThreadId,
      kind: "started",
    });

    pipeline.runLive(
      { kind: "item_completed", item: activity("root-started-child", "child-thread") },
      { source: "live", runtimeId: "runtime-1", threadId: "root-thread" },
    );
    pipeline.runLive(
      { kind: "item_completed", item: activity("child-started-grandchild", "grandchild-thread") },
      { source: "live", runtimeId: "runtime-1", threadId: "child-thread" },
    );

    expect(subagents.routeForChild("child-thread", "runtime-1")).toMatchObject({
      parentExternalSessionId: "root-thread",
      childExternalSessionId: "child-thread",
    });
    expect(subagents.routeForChild("grandchild-thread", "runtime-1")).toMatchObject({
      parentExternalSessionId: "child-thread",
      childExternalSessionId: "grandchild-thread",
    });
  });

  test("does not create routes from unlinked live interacted or interrupted activity", () => {
    const subagents = new CodexSubagentLinkState();
    const pipeline = createCodexEventMapperPipeline(createCodexEventMappers(subagents));
    const activity = (id: string, kind: "interacted" | "interrupted") => ({
      type: "subAgentActivity",
      id,
      agentThreadId: "child-thread",
      kind,
    });

    expect(
      pipeline.runLiveResult(
        { kind: "item_completed", item: activity("unlinked-interacted", "interacted") },
        { source: "live", threadId: "root-thread" },
      ),
    ).toEqual({ handled: true, events: [] });
    expect(
      pipeline.runLiveResult(
        { kind: "item_completed", item: activity("unlinked-interrupted", "interrupted") },
        { source: "live", threadId: "root-thread" },
      ),
    ).toEqual({ handled: true, events: [] });
    expect(subagents.routeForChild("child-thread")).toBeNull();
  });

  test("fails fast for self and conflicting live activity parents", () => {
    const selfPipeline = createCodexEventMapperPipeline(
      createCodexEventMappers(new CodexSubagentLinkState()),
    );
    const selfActivity = {
      type: "subAgentActivity",
      id: "self-started",
      agentThreadId: "root-thread",
      kind: "started",
    };

    expect(() =>
      selfPipeline.runLive(
        { kind: "item_completed", item: selfActivity },
        { source: "live", threadId: "root-thread" },
      ),
    ).toThrow("parent thread matches child thread");

    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      parentThreadId: "root-thread",
      childThreadId: "child-thread",
      itemId: "root-started-child",
      status: "running",
    });
    const conflictPipeline = createCodexEventMapperPipeline(createCodexEventMappers(subagents));

    expect(() =>
      conflictPipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "subAgentActivity",
            id: "other-started-child",
            agentThreadId: "child-thread",
            kind: "started",
          },
        },
        { source: "live", threadId: "other-root-thread" },
      ),
    ).toThrow("already linked to parent");
  });

  test("updates a known child only from its authoritative parent transcript", () => {
    const subagents = new CodexSubagentLinkState();
    const pipeline = createCodexEventMapperPipeline(createCodexEventMappers(subagents));
    subagents.recordThread({
      id: "child-thread",
      cwd: "/repo",
      startedAt: "2026-07-22T00:00:00.000Z",
      updatedAtMs: Date.parse("2026-07-22T00:00:00.000Z"),
      title: "Child",
      parentThreadId: "root-thread",
      status: { classification: "running" },
      agentNickname: null,
      agentRole: null,
      subAgentSource: null,
    });

    const result = pipeline.runThreadItemResult(
      {
        index: 4,
        timestamp: "2026-07-22T00:00:00.000Z",
        item: {
          type: "subAgentActivity",
          id: "root-interacted",
          agentThreadId: "child-thread",
          kind: "interacted",
        },
      },
      { source: "thread_read", threadId: "root-thread" },
    );

    expect(result).toMatchObject({ handled: true });
    expect(result.events).toEqual([
      expect.objectContaining({
        threadId: "root-thread",
        part: expect.objectContaining({
          kind: "subagent",
          externalSessionId: "child-thread",
          correlationKey: "codex-subagent:root-thread:child-thread",
        }),
      }),
    ]);
    expect(subagents.routeForChild("child-thread")).toMatchObject({
      parentExternalSessionId: "root-thread",
      childExternalSessionId: "child-thread",
    });
  });

  test("keeps explicit collab parent conflicts fail-fast", () => {
    const subagents = new CodexSubagentLinkState();
    const pipeline = createCodexEventMapperPipeline(createCodexEventMappers(subagents));
    pipeline.runLive(
      {
        kind: "item_completed",
        item: {
          type: "collabAgentToolCall",
          id: "root-spawn",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "root-thread",
          receiverThreadIds: ["child-thread"],
          agentsStates: { "child-thread": { status: "running" } },
        },
      },
      { source: "live", threadId: "root-thread" },
    );

    expect(() =>
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "other-root-spawn",
            tool: "spawnAgent",
            status: "completed",
            senderThreadId: "other-root-thread",
            receiverThreadIds: ["child-thread"],
            agentsStates: { "child-thread": { status: "running" } },
          },
        },
        { source: "live", threadId: "other-root-thread" },
      ),
    ).toThrow("already linked to parent");
  });

  test("projects thread-read collab items to subagent history instead of generic collab tools", () => {
    const pipeline = createCodexEventMapperPipeline();
    const result = pipeline.runThreadItemResult(
      {
        index: 0,
        timestamp: "2026-05-09T00:00:00.000Z",
        item: {
          type: "collabAgentToolCall",
          id: "spawn-history",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "parent-thread",
          receiverThreadIds: ["child-thread"],
          prompt: "Summarize the failing tests",
          agentsStates: {
            "child-thread": { status: "completed", message: "Done" },
          },
        },
      },
      {
        source: "thread_read",
        threadId: "parent-thread",
        timestamp: "2026-05-09T00:00:00.000Z",
      },
    );

    expect(result.handled).toBe(true);
    const [message] = projectCodexCanonicalEventsToHistory(result.events);
    expect(message?.parts).toEqual([
      expect.objectContaining({
        kind: "subagent",
        correlationKey: "codex-subagent:parent-thread:spawn-history",
        status: "completed",
        externalSessionId: "child-thread",
        description: "Summarize the failing tests",
      }),
    ]);
    expect(message?.parts).not.toEqual([
      expect.objectContaining({
        kind: "tool",
        tool: "collab.spawnAgent",
      }),
    ]);
  });

  test("fails fast on unknown Codex subagent statuses", () => {
    const pipeline = createCodexEventMapperPipeline();

    expect(() =>
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "wait-bad",
            tool: "wait",
            status: "completed",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread"],
            prompt: null,
            agentsStates: {
              "child-thread": { status: "mystery", message: "Unknown" },
            },
          },
        },
        {
          source: "live",
          threadId: "parent-thread",
          timestamp: "2026-05-09T00:00:00.000Z",
        },
      ),
    ).toThrow("unknown collab agent status");
  });

  test("does not mark linked children completed from aggregate-only sendInput updates", () => {
    const pipeline = createCodexEventMapperPipeline();
    const ctx = {
      source: "live" as const,
      threadId: "parent-thread",
      timestamp: "2026-05-09T00:00:00.000Z",
    };
    pipeline.runLive(
      {
        kind: "item_completed",
        item: {
          type: "collabAgentToolCall",
          id: "spawn-1",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "parent-thread",
          receiverThreadIds: ["child-thread"],
          agentsStates: {
            "child-thread": { status: "running" },
          },
        },
      },
      ctx,
    );

    const sendInputEvents = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "send-1",
            tool: "sendInput",
            status: "completed",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread"],
            agentsStates: {},
          },
        },
        ctx,
      ),
    );
    const erroredEvents = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "wait-1",
            tool: "wait",
            status: "failed",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread"],
            agentsStates: {
              "child-thread": { status: "errored", message: "Child failed" },
            },
          },
        },
        ctx,
      ),
    );

    expect(projectedSubagents(sendInputEvents)).toEqual([
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:spawn-1",
        status: "running",
        externalSessionId: "child-thread",
      }),
    ]);
    expect(projectedSubagents(erroredEvents)).toEqual([
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:spawn-1",
        status: "error",
        error: "Child failed",
        externalSessionId: "child-thread",
      }),
    ]);
  });

  test("rejects terminal receiver updates without child agent state", () => {
    const pipeline = createCodexEventMapperPipeline();

    expect(() =>
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "wait-1",
            tool: "wait",
            status: "completed",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread"],
            agentsStates: {},
          },
        },
        {
          source: "live",
          threadId: "parent-thread",
          timestamp: "2026-05-09T00:00:00.000Z",
        },
      ),
    ).toThrow("missing collab agent state");
  });

  test("lets later source-backed child errors override earlier completed state", () => {
    const pipeline = createCodexEventMapperPipeline();
    const ctx = {
      source: "live" as const,
      threadId: "parent-thread",
      timestamp: "2026-05-09T00:00:00.000Z",
    };
    pipeline.runLive(
      {
        kind: "item_completed",
        item: {
          type: "collabAgentToolCall",
          id: "spawn-1",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "parent-thread",
          receiverThreadIds: ["child-thread"],
          agentsStates: {
            "child-thread": { status: "completed", message: "Spawned" },
          },
        },
      },
      ctx,
    );

    const erroredEvents = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "wait-1",
            tool: "wait",
            status: "failed",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread"],
            agentsStates: {
              "child-thread": { status: "errored", message: "Tests failed" },
            },
          },
        },
        ctx,
      ),
    );

    expect(projectedSubagents(erroredEvents)).toEqual([
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:spawn-1",
        status: "error",
        error: "Tests failed",
        externalSessionId: "child-thread",
      }),
    ]);
  });

  test("keeps completed subagent status after later close cleanup", () => {
    const pipeline = createCodexEventMapperPipeline();
    const ctx = {
      source: "live" as const,
      threadId: "parent-thread",
      timestamp: "2026-05-09T00:00:00.000Z",
    };
    pipeline.runLive(
      {
        kind: "item_completed",
        item: {
          type: "collabAgentToolCall",
          id: "spawn-1",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "parent-thread",
          receiverThreadIds: ["child-thread"],
          agentsStates: {
            "child-thread": { status: "completed", message: "Done" },
          },
        },
      },
      ctx,
    );

    const closeEvents = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "collabAgentToolCall",
            id: "close-1",
            tool: "closeAgent",
            status: "completed",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread"],
            agentsStates: {},
          },
        },
        ctx,
      ),
    );

    expect(projectedSubagents(closeEvents)).toEqual([
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:spawn-1",
        status: "completed",
        externalSessionId: "child-thread",
      }),
    ]);
  });

  test("keeps cancelled subagent status after idle inventory refresh", () => {
    const subagents = new CodexSubagentLinkState();
    const cancelled = subagents.upsertLink({
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "activity-1",
      status: "cancelled",
    });

    expect(cancelled).toEqual(expect.objectContaining({ status: "cancelled" }));

    subagents.recordThread({
      id: "child-thread",
      cwd: "/repo",
      startedAt: "2026-05-09T00:00:00.000Z",
      updatedAtMs: Date.parse("2026-05-09T00:01:00.000Z"),
      title: "Child",
      status: { classification: "idle" },
      parentThreadId: "parent-thread",
      agentNickname: null,
      agentRole: null,
      subAgentSource: null,
    });

    expect(
      subagents.upsertLink({
        parentThreadId: "parent-thread",
        childThreadId: "child-thread",
        itemId: "probe-1",
        status: "running",
      }),
    ).toEqual(expect.objectContaining({ status: "cancelled" }));
  });

  test("fails fast when one Codex child is linked to two parents", () => {
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      parentThreadId: "parent-a",
      childThreadId: "child-thread",
      itemId: "spawn-a",
      status: "running",
    });

    expect(() =>
      subagents.upsertLink({
        parentThreadId: "parent-b",
        childThreadId: "child-thread",
        itemId: "spawn-b",
        status: "running",
      }),
    ).toThrow("already linked to parent");
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

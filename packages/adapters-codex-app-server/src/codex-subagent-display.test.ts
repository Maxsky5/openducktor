import { describe, expect, test } from "bun:test";
import { codexAppServerRuntimeNotificationSchema } from "@openducktor/contracts";
import { projectCodexCanonicalEvents } from "./codex-canonical-projector";
import { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import { projectCodexCanonicalEventsToHistory } from "./codex-history-projector";
import { codexCollabAgentToolCallFixture } from "./test-fixtures/codex-protocol";

describe("Codex subagent display details", () => {
  test.each(["live", "thread_read"] as const)(
    "shows the native V2 agent path in %s without inventing a description",
    (source) => {
      const pipeline = createCodexEventMapperPipeline();
      const notification = codexAppServerRuntimeNotificationSchema.parse({
        method: "item/completed",
        params: {
          threadId: "parent-thread",
          turnId: "parent-turn",
          completedAtMs: 1_783_683_601_000,
          item: {
            type: "subAgentActivity",
            id: "spawn-reviewer",
            agentThreadId: "child-thread",
            agentPath: "/root/reviewer/security",
            kind: "started",
          },
        },
      });
      if (notification.method !== "item/completed") {
        throw new Error("Expected item/completed notification");
      }
      const item = notification.params.item;
      const ctx = { source, threadId: "parent-thread" };
      const events =
        source === "live"
          ? pipeline.runLive({ kind: "item_completed", item }, ctx)
          : pipeline.runThreadItem({ index: 0, item }, ctx);
      const parts =
        source === "live"
          ? projectCodexCanonicalEvents(events).flatMap((event) =>
              event.type === "assistant_part" ? [event.part] : [],
            )
          : projectCodexCanonicalEventsToHistory(events).flatMap((message) => message.parts ?? []);

      expect(parts).toEqual([
        expect.objectContaining({
          kind: "subagent",
          agent: "/root/reviewer/security",
          externalSessionId: "child-thread",
          status: "running",
        }),
      ]);
      expect(parts[0]).not.toHaveProperty("description");
      expect(parts[0]).not.toHaveProperty("prompt");
    },
  );

  test("keeps creation details when V2 activity completes a linked child", () => {
    const pipeline = createCodexEventMapperPipeline();
    const ctx = { source: "live" as const, threadId: "parent-thread" };
    pipeline.runLive(
      {
        kind: "item_completed",
        item: codexCollabAgentToolCallFixture({
          id: "spawn-reviewer",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "parent-thread",
          receiverThreadIds: ["child-thread"],
          prompt: "Review the adapter",
          agentsStates: { "child-thread": { status: "running", message: null } },
        }),
      },
      ctx,
    );

    const events = projectCodexCanonicalEvents(
      pipeline.runLive(
        {
          kind: "item_completed",
          item: {
            type: "subAgentActivity",
            id: "reviewer-completed",
            agentThreadId: "child-thread",
            agentPath: "/root/reviewer",
            kind: "completed",
          },
        },
        ctx,
      ),
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "subagent",
          correlationKey: "codex-subagent:parent-thread:spawn-reviewer",
          externalSessionId: "child-thread",
          agent: "/root/reviewer",
          description: "Review the adapter",
          prompt: "Review the adapter",
          status: "completed",
        }),
      }),
    ]);
  });
});

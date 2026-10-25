import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import type { CodexAppServerThreadItem } from "@openducktor/contracts";
import {
  codexSessionRuntimeRef,
  codexThreadFixture,
  codexTurnFixture,
  createAdapterWithTransport,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
  RecordingTransport,
  requestThreadId,
} from "./codex-app-server-adapter.test-harness";
import type { CodexJsonRpcRequest } from "./index";

const description = "Inventory hard-coded workflow artifacts";
const childThread = () =>
  codexThreadFixture({
    id: "child-thread",
    parentThreadId: "parent-thread",
    preview: description,
    name: "Workflow artifact audit",
    agentNickname: "Scout",
    agentRole: "explorer",
    status: { type: "active", activeFlags: [] },
  });

const activity = (kind: "started" | "completed") => ({
  type: "subAgentActivity" as const,
  id: `child-${kind}`,
  kind,
  agentThreadId: "child-thread",
  agentPath: "/root/meaningless_identifier",
});

class SubagentMetadataTransport extends RecordingTransport {
  child = childThread();
  items: CodexAppServerThreadItem[] = [activity("started"), activity("completed")];

  override async request(request: CodexJsonRpcRequest) {
    if (request.method === "thread/read" && requestThreadId(request.params) === "child-thread") {
      this.calls.push(request);
      return { thread: this.child };
    }
    if (request.method === "thread/turns/list") {
      this.calls.push(request);
      return {
        data: [
          codexTurnFixture({
            id: "parent-turn",
            status: "completed",
            items: this.items,
          }),
        ],
        nextCursor: null,
        backwardsCursor: null,
      };
    }
    return super.request(request);
  }
}

describe("Codex subagent metadata", () => {
  test.each([
    { order: "before", status: "active" },
    { order: "after", status: "active" },
    { order: "before", status: "idle" },
    { order: "after", status: "idle" },
  ] as const)(
    "shows native task text with $status metadata $order the activity item",
    async ({ order, status }) => {
      const stream = createRuntimeStreamSubscription();
      const transport = new SubagentMetadataTransport("runtime-live", false);
      const adapter = createAdapterWithTransport(transport, {
        subscribeEvents: stream.subscribeEvents,
      });
      const parent = codexSessionRuntimeRef("parent-thread");
      await adapter.resumeSession(parent);
      const events: AgentEvent[] = [];
      const unsubscribe = await adapter.subscribeEvents(parent, (event) => events.push(event));
      const child = childThread();
      if (status === "idle") child.status = { type: "idle" };
      const metadata = { method: "thread/started", params: { thread: child } };
      const started = {
        method: "item/completed",
        params: {
          threadId: "parent-thread",
          turnId: "parent-turn",
          completedAtMs: 1_783_683_601_000,
          item: activity("started"),
        },
      };
      try {
        for (const notification of order === "before" ? [metadata, started] : [started, metadata]) {
          stream.emitNotification(notification);
          await flushCodexAdapterWork();
        }
        expect(events.at(-1)).toMatchObject({
          type: "assistant_part",
          part: { agent: "Scout", description, status: "running" },
        });
        stream.emitNotification({
          method: "item/completed",
          params: {
            ...started.params,
            item: activity("completed"),
          },
        });
        await flushCodexAdapterWork();

        expect(events.at(-1)).toMatchObject({
          type: "assistant_part",
          externalSessionId: "parent-thread",
          part: {
            kind: "subagent",
            externalSessionId: "child-thread",
            agent: "Scout",
            description,
            status: "completed",
          },
        });
        expect(transport.calls.filter((call) => call.method === "thread/read")).toHaveLength(0);
      } finally {
        unsubscribe();
      }
    },
  );

  test("loads each referenced child's native description once for history", async () => {
    const transport = new SubagentMetadataTransport("runtime-live", false);
    const adapter = createAdapterWithTransport(transport);

    const history = await adapter.loadSessionHistory(codexSessionRuntimeRef("parent-thread"));
    const parts = history.flatMap((message) => message.parts);

    expect(parts).toEqual([
      expect.objectContaining({ kind: "subagent", agent: "Scout", description, status: "running" }),
      expect.objectContaining({
        kind: "subagent",
        agent: "Scout",
        description,
        status: "completed",
      }),
    ]);
    expect(
      transport.calls.filter(
        (call) => call.method === "thread/read" && requestThreadId(call.params) === "child-thread",
      ),
    ).toHaveLength(1);
  });

  test.each([
    { preview: " ", name: "Review workflow actions", expected: "Review workflow actions" },
    { preview: " ", name: null, expected: undefined },
  ])(
    "uses only native text when the preview is empty: $name",
    async ({ preview, name, expected }) => {
      const transport = new SubagentMetadataTransport("runtime-live", false);
      Object.assign(transport.child, { preview, name, agentNickname: null, agentRole: null });
      const history = await createAdapterWithTransport(transport).loadSessionHistory(
        codexSessionRuntimeRef("parent-thread"),
      );

      const parts = history.flatMap((message) => message.parts);
      expect(parts).toHaveLength(2);
      for (const part of parts) {
        expect(part).not.toHaveProperty("agent");
        if (expected) expect(part).toMatchObject({ description: expected });
        else expect(part).not.toHaveProperty("description");
      }
    },
  );

  test.each(["working directory", "malformed metadata"])(
    "reports a child %s failure to its retained parent",
    async (failure) => {
      const stream = createRuntimeStreamSubscription();
      const adapter = createAdapterWithTransport(
        new SubagentMetadataTransport("runtime-live", false),
        {
          subscribeEvents: stream.subscribeEvents,
        },
      );
      const parent = codexSessionRuntimeRef("parent-thread");
      await adapter.resumeSession(parent);
      const events: AgentEvent[] = [];
      const unsubscribe = await adapter.subscribeEvents(parent, (event) => events.push(event));
      try {
        const child = childThread();
        stream.emitNotification({
          method: "thread/started",
          params: {
            thread:
              failure === "working directory"
                ? { ...child, cwd: "/another-repo" }
                : { ...child, preview: null },
          },
        });
        await flushCodexAdapterWork();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: "session_error",
            externalSessionId: "parent-thread",
            message: expect.stringContaining(
              failure === "working directory" ? "working directory" : "preview",
            ),
          }),
        );
        expect(events.some((event) => event.type === "assistant_part")).toBe(false);
      } finally {
        unsubscribe();
      }
    },
  );

  test("routes grandchild display details through its unretained parent", async () => {
    const stream = createRuntimeStreamSubscription();
    const events: AgentEvent[] = [];
    const adapter = createAdapterWithTransport(
      new SubagentMetadataTransport("runtime-live", false),
      {
        subscribeEvents: stream.subscribeEvents,
        onLiveSessionMutation: (mutation) => {
          events.push(...mutation.transcriptEvents);
        },
      },
    );
    await adapter.resumeSession(codexSessionRuntimeRef("parent-thread"));
    stream.emitNotification({ method: "thread/started", params: { thread: childThread() } });
    await flushCodexAdapterWork();
    stream.emitNotification({
      method: "thread/started",
      params: {
        thread: { ...childThread(), id: "grandchild-thread", parentThreadId: "child-thread" },
      },
    });
    await flushCodexAdapterWork();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        externalSessionId: "child-thread",
        part: expect.objectContaining({
          externalSessionId: "grandchild-thread",
          agent: "Scout",
          description,
        }),
      }),
    );
    expect(events.some((event) => event.type === "session_error")).toBe(false);
  });

  test("does not read metadata for interaction targets that are not owned children", async () => {
    const transport = new SubagentMetadataTransport("runtime-live", false);
    transport.items = [
      { ...activity("started"), kind: "interacted" },
      { ...activity("completed"), kind: "interrupted" },
    ];
    const history = await createAdapterWithTransport(transport).loadSessionHistory(
      codexSessionRuntimeRef("parent-thread"),
    );

    expect(history).toEqual([]);
    expect(
      transport.calls.filter(
        (call) => call.method === "thread/read" && requestThreadId(call.params) === "child-thread",
      ),
    ).toHaveLength(0);
  });

  test.each(["id", "parentThreadId", "cwd"] as const)(
    "rejects child metadata with a mismatched %s",
    async (field) => {
      const transport = new SubagentMetadataTransport("runtime-live", false);
      transport.child[field] = "another-scope";
      const adapter = createAdapterWithTransport(transport);

      await expect(
        adapter.loadSessionHistory(codexSessionRuntimeRef("parent-thread")),
      ).rejects.toThrow("subagent metadata");
    },
  );
});

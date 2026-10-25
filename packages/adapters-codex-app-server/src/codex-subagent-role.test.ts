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
import { codexCollabAgentToolCallFixture } from "./test-fixtures/codex-protocol";
import type { CodexJsonRpcRequest } from "./index";

const activity = (kind: "started" | "completed", childThreadId = "child-thread") => ({
  type: "subAgentActivity" as const,
  id: `${childThreadId}-${kind}`,
  kind,
  agentThreadId: childThreadId,
  agentPath: "/root/not_an_agent_description",
});

class SubagentRoleTransport extends RecordingTransport {
  child = codexThreadFixture({
    id: "child-thread",
    parentThreadId: "parent-thread",
    agentNickname: "Raman",
    agentRole: "explorer",
    preview: "An unrelated thread preview",
    name: "An unrelated thread title",
    status: { type: "idle" },
  });
  items: CodexAppServerThreadItem[] = [activity("started"), activity("completed")];

  constructor() {
    super("runtime-live", false);
  }

  override async request(request: CodexJsonRpcRequest) {
    if (request.method === "thread/read") {
      const id = requestThreadId(request.params);
      if (id === "child-thread" || id === "grandchild-thread") {
        this.calls.push(request);
        return {
          thread:
            id === "child-thread"
              ? this.child
              : { ...this.child, id, parentThreadId: "child-thread" },
        };
      }
    }
    if (request.method === "thread/turns/list") {
      this.calls.push(request);
      return {
        data: [codexTurnFixture({ id: "parent-turn", status: "completed", items: this.items })],
        nextCursor: null,
        backwardsCursor: null,
      };
    }
    return super.request(request);
  }
}

const observeParent = async (transport = new SubagentRoleTransport()) => {
  const stream = createRuntimeStreamSubscription();
  const events: AgentEvent[] = [];
  const adapter = createAdapterWithTransport(transport, {
    subscribeEvents: stream.subscribeEvents,
    onLiveSessionMutation: (mutation) => {
      events.push(...mutation.transcriptEvents);
    },
  });
  await adapter.resumeSession(codexSessionRuntimeRef("parent-thread"));
  return {
    transport,
    stream,
    events,
    async emit(
      kind: "started" | "completed" = "started",
      parentThreadId = "parent-thread",
      childThreadId = "child-thread",
    ) {
      stream.emitNotification({
        method: "item/completed",
        params: {
          threadId: parentThreadId,
          turnId: `${parentThreadId}-turn`,
          completedAtMs: 1_783_683_601_000,
          item: activity(kind, childThreadId),
        },
      });
      await flushCodexAdapterWork();
    },
  };
};

describe("Codex subagent roles", () => {
  test.each([
    { role: "thermo-nuclear-review-subagent", nickname: "Dalton", prompt: null },
    { role: "thermo-nuclear-code-quality-review-subagent", nickname: "Godel", prompt: null },
    { role: "explorer", nickname: "Raman", prompt: "Review the adapter" },
  ])(
    "loads $role once at discovery and keeps it through completion",
    async ({ role, nickname, prompt }) => {
      const live = await observeParent();
      Object.assign(live.transport.child, { agentRole: role, agentNickname: nickname });
      if (prompt) {
        live.stream.emitNotification({
          method: "item/completed",
          params: {
            threadId: "parent-thread",
            turnId: "parent-thread-turn",
            completedAtMs: 1_783_683_600_000,
            item: codexCollabAgentToolCallFixture({
              id: "legacy-spawn",
              tool: "spawnAgent",
              status: "completed",
              senderThreadId: "parent-thread",
              receiverThreadIds: ["child-thread"],
              prompt,
              agentsStates: { "child-thread": { status: "running", message: null } },
            }),
          },
        });
        await flushCodexAdapterWork();
      }
      await live.emit();
      await live.emit();
      expect(live.events.at(-1)).toMatchObject({
        type: "assistant_part",
        part: { agent: role, status: "running" },
      });
      await live.emit("completed");

      const last = live.events.at(-1);
      expect(last).toMatchObject({
        type: "assistant_part",
        externalSessionId: "parent-thread",
        part: {
          kind: "subagent",
          externalSessionId: "child-thread",
          agent: role,
          status: "completed",
        },
      });
      if (last?.type !== "assistant_part") throw new Error("Expected a subagent update");
      if (prompt) expect(last.part).toMatchObject({ prompt, description: prompt });
      else {
        expect(last.part).not.toHaveProperty("description");
        expect(last.part).not.toHaveProperty("prompt");
      }
      expect(live.transport.calls.filter((call) => call.method === "thread/read")).toHaveLength(1);
    },
  );

  test.each([
    { role: "explorer", sourceRole: "reviewer", expected: "explorer" },
    { role: null, sourceRole: "reviewer", expected: "reviewer" },
    { role: null, sourceRole: null, expected: undefined },
  ])(
    "loads history with the configured role, not a nickname: $expected",
    async ({ role, sourceRole, expected }) => {
      const transport = new SubagentRoleTransport();
      transport.child.agentRole = role;
      transport.child.source = {
        subAgent: {
          thread_spawn: {
            parent_thread_id: "parent-thread",
            depth: 1,
            agent_path: "/root/not_an_agent_description",
            agent_nickname: "Raman",
            agent_role: sourceRole,
          },
        },
      };
      const history = await createAdapterWithTransport(transport).loadSessionHistory(
        codexSessionRuntimeRef("parent-thread"),
      );
      const parts = history.flatMap((message) => message.parts);

      expect(parts.map((part) => (part.kind === "subagent" ? part.status : part.kind))).toEqual([
        "running",
        "completed",
      ]);
      for (const part of parts) {
        if (expected) expect(part).toMatchObject({ agent: expected });
        else expect(part).not.toHaveProperty("agent");
        expect(part).not.toHaveProperty("description");
        expect(part).not.toHaveProperty("prompt");
      }
      expect(
        transport.calls.filter(
          (call) =>
            call.method === "thread/read" && requestThreadId(call.params) === "child-thread",
        ),
      ).toHaveLength(1);
    },
  );

  test.each(["working directory", "agentRole"])(
    "reports invalid %s without retrying or publishing a generic card",
    async (field) => {
      const transport = new SubagentRoleTransport();
      if (field === "working directory") transport.child.cwd = "/another-repo";
      else Object.assign(transport.child, { agentRole: 123 });
      const live = await observeParent(transport);
      await live.emit();
      await live.emit();

      expect(live.events).toContainEqual(
        expect.objectContaining({
          type: "session_error",
          externalSessionId: "parent-thread",
          message: expect.stringContaining(field),
        }),
      );
      expect(live.events.some((event) => event.type === "assistant_part")).toBe(false);
      expect(transport.calls.filter((call) => call.method === "thread/read")).toHaveLength(1);
    },
  );

  test("routes a grandchild role through its unretained parent", async () => {
    const live = await observeParent();
    await live.emit();
    await live.emit("started", "child-thread", "grandchild-thread");

    expect(live.events).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        externalSessionId: "child-thread",
        part: expect.objectContaining({
          externalSessionId: "grandchild-thread",
          agent: "explorer",
        }),
      }),
    );
    expect(live.events.some((event) => event.type === "session_error")).toBe(false);
  });

  test("does not read roles for interaction targets that are not owned children", async () => {
    const transport = new SubagentRoleTransport();
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
      const transport = new SubagentRoleTransport();
      transport.child[field] = "another-scope";
      await expect(
        createAdapterWithTransport(transport).loadSessionHistory(
          codexSessionRuntimeRef("parent-thread"),
        ),
      ).rejects.toThrow("subagent metadata");
    },
  );
});

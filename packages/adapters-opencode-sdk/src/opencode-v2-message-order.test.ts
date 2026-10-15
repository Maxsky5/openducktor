import { describe, expect, test } from "bun:test";
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client";
import type { OpencodeSessionRuntimeSignal } from "./opencode-session-runtime-signals";
import { prepareFixture } from "./opencode-v2-live.test-support";
import { cursorPage, model, ref } from "./opencode-v2.test-support";

describe("OpenCode V2 message order", () => {
  test.each([
    { missing: ["first"], later: false },
    { missing: ["middle"], later: false },
    { missing: ["first", "middle", "last"], later: false },
    { missing: ["last"], later: true },
  ])("keeps missing calls $missing in order (later=$later)", async ({ missing, later }) => {
    const message: SessionMessageAssistant = {
      id: "msg_order",
      type: "assistant",
      time: { created: 2, completed: 8 },
      agent: "build",
      model,
      content: [
        call("first", "subagent"),
        { type: "text", text: "After first call" },
        call("middle", "shell"),
        { type: "reasoning", text: "After middle call" },
        call("last", "subagent"),
      ],
    };
    let snapshots = [message];
    const fixture = prepareFixture(({ url }) =>
      url.pathname.endsWith("/message") ? cursorPage(snapshots) : undefined,
    );
    const runtime = await fixture.prepare();
    const observed = Promise.withResolvers<void>();
    const replay: OpencodeSessionRuntimeSignal[] = [];
    try {
      await runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "repository" } },
      ]);
      await runtime.startForwarding((signal) => {
        if (signal.type === "fault" || signal.type === "session_fault")
          observed.reject(new Error(signal.message));
        if (signal.type === "session_event" && signal.provenance === "baseline")
          replay.push(signal);
        if (signal.type === "runtime_notice" && signal.message === "Reconnect settled")
          observed.resolve();
      });
      const saved = structuredClone(message);
      saved.content = saved.content.filter(
        (part) => part.type !== "tool" || !missing.some((id) => part.id === `call_${id}`),
      );
      if (later) saved.content.push({ type: "text", text: "Later saved summary" });
      snapshots = [saved];
      const expected = [
        { kind: "subagent", correlationKey: "call:call_first" },
        { kind: "text", text: "After first call" },
        { kind: "tool", callId: "call_middle" },
        { kind: "reasoning", text: "After middle call" },
        { kind: "subagent", correlationKey: "call:call_last" },
      ];
      if (later) expected.push({ kind: "text", text: "Later saved summary" });
      expect((await runtime.queries.loadSessionHistory(ref))[0]?.parts).toMatchObject(expected);
      replay.length = 0;
      fixture.channel.push({ id: "connected-order", type: "server.connected", data: {} });
      fixture.channel.push({
        id: "evt_order_settled",
        type: "tui.toast.show",
        created: 9,
        data: { message: "Reconnect settled", variant: "warning" },
      });
      await observed.promise;
      expect(
        replay.flatMap((signal) =>
          signal.type === "session_event" && signal.event.type === "assistant_part"
            ? [signal.event.part]
            : [],
        ),
      ).toMatchObject(expected);
      expect((await runtime.queries.loadSessionHistory(ref))[0]?.parts).toMatchObject(expected);
    } finally {
      await runtime.release();
    }
  });
});

const call = (id: string, name: string): SessionMessageAssistantTool => ({
  type: "tool",
  id: `call_${id}`,
  name,
  time: { created: 3, ran: 4, completed: 5 },
  state: {
    status: "completed",
    input: { agent: "general", prompt: "Check changes" },
    content: [{ type: "text", text: "Done" }],
    metadata: { sessionID: `ses_${id}`, status: "completed" },
  },
});

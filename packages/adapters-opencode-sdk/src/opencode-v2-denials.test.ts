import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo, V2Event } from "@opencode/client";
import type { AgentTranscriptStreamPart } from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import type { OpencodeSessionRuntimeSignal } from "./opencode-session-runtime-signals";
import { durable, prepareFixture } from "./opencode-v2-live.test-support";
import { model, noContent, ref, response } from "./opencode-v2.test-support";

const callId = "call_shell";
const messageId = "msg_denied";
const rejected = { type: "permission.rejected", message: "Denied by rule: bash rm *" };

const stepStarted: V2Event = {
  id: "evt_step",
  type: "session.step.started",
  created: 2,
  durable,
  data: {
    sessionID: ref.externalSessionId,
    assistantMessageID: messageId,
    agent: "build",
    model,
    started: 2,
  },
};
const toolStarted: V2Event = {
  id: "evt_tool_start",
  type: "session.tool.input.started",
  created: 3,
  durable: { ...durable, seq: 2 },
  data: {
    sessionID: ref.externalSessionId,
    assistantMessageID: messageId,
    id: callId,
    name: "bash",
  },
};
const toolCalled: V2Event = {
  id: "evt_tool_called",
  type: "session.tool.called",
  created: 4,
  durable: { ...durable, seq: 3 },
  data: {
    sessionID: ref.externalSessionId,
    assistantMessageID: messageId,
    id: callId,
    input: { command: "rm -rf build" },
  },
};
const toolFailed = (error: { type: string; message: string }): V2Event => ({
  id: "evt_tool_failed",
  type: "session.tool.failed",
  created: 5,
  durable: { ...durable, seq: 4 },
  data: {
    sessionID: ref.externalSessionId,
    assistantMessageID: messageId,
    id: callId,
    error,
    executed: false,
  },
});

const toolPart = (events: AgentEvent[]) =>
  events.flatMap((event) =>
    event.type === "assistant_part" && event.part.kind === "tool" && event.part.callId === callId
      ? [event.part]
      : [],
  )[0];

const historyToolPart = (projector: OpenCodeLiveMessageProjector) =>
  projector
    .projectHistory([...projector.messages.values()])
    .flatMap((message) => message.parts)
    .find(
      (part): part is Extract<AgentTranscriptStreamPart, { kind: "tool" }> =>
        part.kind === "tool" && part.callId === callId,
    );

const runCall = (
  error: { type: string; message: string },
  ask?: { roleReject: boolean },
): OpenCodeLiveMessageProjector => {
  const projector = new OpenCodeLiveMessageProjector();
  projector.apply(stepStarted);
  projector.apply(toolStarted);
  projector.apply(toolCalled);
  if (ask) {
    projector.recordApprovalAsk("permission_1", callId);
    if (ask.roleReject) projector.recordRoleReject("permission_1");
  }
  const part = toolPart(projector.apply(toolFailed(error)));
  expect(part).toMatchObject({ status: "error", error: error.message });
  return projector;
};

describe("OpenCode automatic denials", () => {
  test("marks a rejection with no prompt as a permission settings denial", () => {
    const projector = runCall(rejected);
    const expected = { source: "permission_settings", reason: rejected.message };
    expect(historyToolPart(projector)?.denial).toEqual(expected);
    expect(toolPart(projector.snapshotEvents(ref.externalSessionId))?.denial).toEqual(expected);
  });

  test("keeps a user rejection after a prompt as a plain rejected call", () => {
    const projector = runCall(rejected, { roleReject: false });
    expect(historyToolPart(projector)).toMatchObject({ status: "error", error: rejected.message });
    expect(historyToolPart(projector)?.denial).toBeUndefined();
  });

  test("marks a host rejection for the read-only role as a role denial", () => {
    const projector = runCall(
      { type: "permission.rejected", message: "Read-only role." },
      { roleReject: true },
    );
    expect(historyToolPart(projector)?.denial).toEqual({
      source: "read_only_role",
      reason: "Read-only role.",
    });
  });

  test("keeps failures of other types plain", () => {
    const projector = runCall({ type: "aborted", message: "Tool execution interrupted" });
    expect(historyToolPart(projector)?.denial).toBeUndefined();
  });

  test("keeps a rejected call of a restored baseline plain", () => {
    const projector = new OpenCodeLiveMessageProjector();
    const baseline: SessionMessageInfo = {
      id: messageId,
      type: "assistant",
      agent: "build",
      model,
      time: { created: 2, completed: 6 },
      content: [
        {
          type: "tool",
          id: callId,
          name: "bash",
          time: { created: 3, ran: 4, completed: 5 },
          state: { status: "error", input: { command: "rm -rf build" }, error: rejected },
        },
      ],
    };
    projector.seed([baseline]);
    expect(toolPart(projector.snapshotEvents(ref.externalSessionId))).toMatchObject({
      status: "error",
      error: rejected.message,
    });
    expect(toolPart(projector.snapshotEvents(ref.externalSessionId))?.denial).toBeUndefined();
  });

  test.each([
    { label: "a user rejection stays plain", roleReject: false, denial: undefined },
    {
      label: "a role rejection is a role denial",
      roleReject: true,
      denial: { source: "read_only_role", reason: "Rejected." },
    },
  ])("treats a prompt that the snapshot restores as an ask: $label", async (scenario) => {
    const fixture = prepareFixture(({ url, method }) => {
      if (method === "GET" && url.pathname.endsWith("/permission"))
        return response([
          {
            id: "permission_1",
            sessionID: ref.externalSessionId,
            action: "bash",
            resources: ["rm -rf build"],
            source: { type: "tool", messageID: messageId, id: callId },
          },
        ]);
      if (method === "POST" && url.pathname.endsWith("/permission/permission_1/reply"))
        return noContent();
      return undefined;
    });
    const runtime = await fixture.prepare();
    const parts: Array<Extract<AgentTranscriptStreamPart, { kind: "tool" }>> = [];
    const failed = Promise.withResolvers<void>();
    try {
      await runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "repository", workspaceId: "repo" } },
      ]);
      await runtime.startForwarding((signal: OpencodeSessionRuntimeSignal) => {
        if (
          signal.type === "session_event" &&
          signal.event.type === "assistant_part" &&
          signal.event.part.kind === "tool" &&
          signal.event.part.callId === callId
        ) {
          parts.push(signal.event.part);
          if (signal.event.part.status === "error") failed.resolve();
        }
      });
      fixture.channel.push(stepStarted);
      fixture.channel.push(toolStarted);
      fixture.channel.push(toolCalled);
      const reply: Parameters<typeof runtime.connection.replyApproval>[0] = {
        ref,
        nativeRequestId: "permission_1",
        outcome: "reject",
        message: "Rejected.",
      };
      if (scenario.roleReject) reply.denialSource = "read_only_role";
      await runtime.connection.replyApproval(reply);
      fixture.channel.push(toolFailed({ type: "permission.rejected", message: "Rejected." }));
      await failed.promise;
      expect(parts.at(-1)).toMatchObject({ status: "error", error: "Rejected." });
      expect(parts.at(-1)?.denial).toEqual(scenario.denial);
    } finally {
      await runtime.release();
    }
  });

  test("links a host role rejection to the call of the native prompt", async () => {
    const fixture = prepareFixture(({ url, method }) =>
      method === "POST" && url.pathname.endsWith("/permission/permission_1/reply")
        ? noContent()
        : undefined,
    );
    const runtime = await fixture.prepare();
    const parts: Array<Extract<AgentTranscriptStreamPart, { kind: "tool" }>> = [];
    const asked = Promise.withResolvers<void>();
    const failed = Promise.withResolvers<void>();
    try {
      await runtime.connection.resumeSession({
        ...ref,
        runtimePolicy: { kind: "opencode" },
        sessionScope: { kind: "repository", workspaceId: "repo" },
      });
      await runtime.startForwarding((signal: OpencodeSessionRuntimeSignal) => {
        if (signal.type !== "session_event") return;
        if (signal.event.type === "approval_required") asked.resolve();
        if (
          signal.event.type === "assistant_part" &&
          signal.event.part.kind === "tool" &&
          signal.event.part.callId === callId
        ) {
          parts.push(signal.event.part);
          if (signal.event.part.status === "error") failed.resolve();
        }
      });
      fixture.channel.push(stepStarted);
      fixture.channel.push(toolStarted);
      fixture.channel.push(toolCalled);
      fixture.channel.push({
        id: "evt_permission",
        type: "permission.asked",
        created: 5,
        location: { directory: ref.workingDirectory },
        data: {
          id: "permission_1",
          sessionID: ref.externalSessionId,
          action: "bash",
          resources: ["rm -rf build"],
          source: { type: "tool", messageID: messageId, id: callId },
        },
      });
      await asked.promise;
      await runtime.connection.replyApproval({
        ref,
        nativeRequestId: "permission_1",
        outcome: "reject",
        message: "Read-only role.",
        denialSource: "read_only_role",
      });
      fixture.channel.push(toolFailed({ type: "permission.rejected", message: "Read-only role." }));
      await failed.promise;
      expect(parts.at(-1)?.denial).toEqual({
        source: "read_only_role",
        reason: "Read-only role.",
      });
    } finally {
      await runtime.release();
    }
  });
});

import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo } from "@opencode/client";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import { projectMessage, projectMessages } from "./opencode-message-projection";
import type { OpencodeSessionRuntimeSignal } from "./opencode-session-runtime-signals";
import { backgroundLaunch, durable, prepareFixture } from "./opencode-v2-live.test-support";
import { cursorPage, location, model, ref, response, session } from "./opencode-v2.test-support";

describe("OpenCode V2 subagent projection and history", () => {
  test("routes background results by session ID", async () => {
    const other = {
      ...ref,
      repoPath: "/other",
      workingDirectory: "/other",
      externalSessionId: "ses_other",
    };
    const fixture = prepareFixture(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/session/ses_other")
        return response(
          session({ id: other.externalSessionId, location: { directory: "/other" } }),
        );
      if (url.pathname === `/api/session/${ref.externalSessionId}/message`)
        return cursorPage([backgroundLaunch()]);
      if (
        url.pathname === "/api/location" &&
        url.searchParams.get("location[directory]") === "/other"
      )
        return Response.json({
          ...location,
          directory: "/other",
          project: { ...location.project, directory: "/other" },
        });
      return undefined;
    });
    const runtime = await fixture.prepare();
    const signals: OpencodeSessionRuntimeSignal[] = [];
    const observed = Promise.withResolvers<void>();
    try {
      for (const root of [ref, other]) {
        const restored = await runtime.connection.readSessionSources(root.repoPath, [
          { ...root, sessionScope: { kind: "repository" } },
        ]);
        expect(restored.failures).toEqual([]);
      }
      await runtime.startForwarding((signal) => {
        signals.push(signal);
        if (signal.type === "fault" || signal.type === "session_fault")
          observed.reject(new Error(signal.message));
        if (signal.type === "runtime_notice" && signal.message === "Completion observed")
          observed.resolve();
      });
      // Native background jobs publish with their cached directory, not the parent's location.
      fixture.channel.push({
        id: "evt_background_completion",
        type: "session.inbox.enqueued",
        created: 10,
        durable,
        location: { directory: other.workingDirectory },
        data: {
          sessionID: ref.externalSessionId,
          inboxID: "msg_background_completion",
          item: {
            type: "synthetic",
            delivery: "steer",
            payload: {
              text: "Native child finished",
              metadata: { source: "subagent", childID: "ses_child", state: "completed" },
            },
          },
        },
      });
      fixture.channel.push({
        id: "evt_background_delivered",
        type: "session.inbox.delivered",
        created: 11,
        durable: { ...durable, seq: 2 },
        data: { sessionID: ref.externalSessionId, inboxID: "msg_background_completion" },
      });
      fixture.channel.push({
        id: "evt_other_started",
        type: "session.execution.started",
        created: 12,
        location: { directory: ref.workingDirectory },
        data: { sessionID: other.externalSessionId },
      });
      fixture.channel.push({
        id: "evt_unadmitted_started",
        type: "session.execution.started",
        location: { directory: ref.workingDirectory },
        data: { sessionID: "ses_unadmitted" },
      });
      fixture.channel.push({
        id: "evt_completion_observed",
        type: "tui.toast.show",
        data: { message: "Completion observed", variant: "warning" },
      });
      await observed.promise;
      expect(signals).toContainEqual(
        expect.objectContaining({
          type: "session_event",
          externalSessionId: ref.externalSessionId,
          event: expect.objectContaining({
            type: "assistant_part",
            part: expect.objectContaining({ kind: "subagent", status: "completed" }),
          }),
        }),
      );
      expect(signals).toContainEqual(
        expect.objectContaining({
          type: "session_event",
          externalSessionId: other.externalSessionId,
          event: expect.objectContaining({
            type: "session_status",
            status: { type: "busy", message: null },
          }),
        }),
      );
      expect(
        signals.some(
          (signal) =>
            "externalSessionId" in signal && signal.externalSessionId === "ses_unadmitted",
        ),
      ).toBe(false);
      for (const root of [ref, other])
        expect(
          await runtime.connection.updateSessionTitle({ ...root, title: "Still connected" }),
        ).toMatchObject({ status: "renamed" });
    } finally {
      await runtime.release();
    }
  });

  test.each(["running", "streaming", "empty", "missing"] as const)(
    "keeps live subagent links and final state over older %s history",
    async (baseline) => {
      const message: SessionMessageInfo = {
        id: "msg_foreground",
        type: "assistant",
        time: { created: 2 },
        agent: "build",
        model,
        content: [
          {
            type: "tool",
            id: "call_foreground",
            name: "subagent",
            time: baseline === "streaming" ? { created: 3 } : { created: 3, ran: 4 },
            state:
              baseline === "streaming"
                ? { status: "streaming", input: "" }
                : {
                    status: "running",
                    input: {
                      agent: "general",
                      description: "Check source",
                      prompt: "Check source",
                    },
                    metadata: {},
                  },
          },
        ],
      };
      if (baseline === "empty" || baseline === "missing") message.content = [];
      const snapshots = baseline === "missing" ? [] : [message];
      let delayedHistory = Promise.withResolvers<Response>();
      let historyStarted = Promise.withResolvers<void>();
      let delayHistory = false;
      const fixture = prepareFixture(({ url }) => {
        if (!url.pathname.endsWith("/message")) return undefined;
        if (!delayHistory) return cursorPage(snapshots);
        historyStarted.resolve();
        return delayedHistory.promise;
      });
      const runtime = await fixture.prepare();
      const observed = Promise.withResolvers<void>();
      const completed = Promise.withResolvers<void>();
      try {
        await runtime.connection.readSessionSources(ref.repoPath, [
          { ...ref, sessionScope: { kind: "repository" } },
        ]);
        await runtime.startForwarding((signal) => {
          if (signal.type === "fault" || signal.type === "session_fault")
            observed.reject(new Error(signal.message));
          if (
            signal.type === "session_event" &&
            signal.event.type === "assistant_part" &&
            signal.event.part.kind === "subagent" &&
            signal.event.part.externalSessionId === "ses_child"
          ) {
            if (signal.event.part.status === "completed") completed.resolve();
            else {
              expect(signal.event.part).toMatchObject({
                status: "running",
                executionMode: "foreground",
              });
              observed.resolve();
            }
          }
        });
        delayHistory = true;
        const runningRead = runtime.queries.loadSessionHistory(ref);
        await historyStarted.promise;
        if (baseline === "missing") {
          fixture.channel.push({
            id: "evt_foreground_step",
            type: "session.step.started",
            created: 2,
            durable,
            data: {
              sessionID: ref.externalSessionId,
              assistantMessageID: message.id,
              agent: "build",
              model,
              started: 2,
            },
          });
        }
        if (baseline === "empty" || baseline === "missing") {
          fixture.channel.push({
            id: "evt_foreground_input",
            type: "session.tool.input.started",
            created: 3,
            durable: { ...durable, seq: 2 },
            data: {
              sessionID: ref.externalSessionId,
              assistantMessageID: message.id,
              id: "call_foreground",
              name: "subagent",
            },
          });
        }
        if (baseline !== "running") {
          fixture.channel.push({
            id: "evt_foreground_called",
            type: "session.tool.called",
            created: 4,
            durable: { ...durable, seq: 3 },
            data: {
              sessionID: ref.externalSessionId,
              assistantMessageID: message.id,
              id: "call_foreground",
              input: { agent: "general", description: "Check source", prompt: "Check source" },
              executed: false,
            },
          });
        }
        fixture.channel.push({
          id: "evt_foreground_progress",
          type: "session.tool.progress",
          created: 5,
          data: {
            sessionID: ref.externalSessionId,
            assistantMessageID: message.id,
            id: "call_foreground",
            metadata: { sessionID: "ses_child", status: "running" },
          },
        });
        await observed.promise;
        delayedHistory.resolve(cursorPage(snapshots));
        const history = await runningRead;
        expect(history[0]?.parts.find((part) => part.kind === "subagent")).toMatchObject({
          externalSessionId: "ses_child",
          status: "running",
          executionMode: "foreground",
        });
        expect(history[0]?.parts.filter((part) => part.kind === "tool")).toEqual([]);
        delayedHistory = Promise.withResolvers<Response>();
        historyStarted = Promise.withResolvers<void>();
        const reading = runtime.queries.loadSessionHistory(ref);
        await historyStarted.promise;
        fixture.channel.push({
          id: "evt_foreground_success",
          type: "session.tool.success",
          created: 9,
          durable: { ...durable, seq: 4, version: 2 },
          data: {
            sessionID: ref.externalSessionId,
            assistantMessageID: message.id,
            id: "call_foreground",
            content: [{ type: "text", text: "Review complete" }],
            executed: false,
            metadata: { sessionID: "ses_child", status: "completed" },
          },
        });
        await completed.promise;
        delayedHistory.resolve(cursorPage(snapshots));
        const staleHistory = await reading;
        expect(staleHistory[0]?.parts).toMatchObject([
          {
            kind: "subagent",
            externalSessionId: "ses_child",
            status: "completed",
            endedAtMs: 9,
          },
        ]);
      } finally {
        delayedHistory.resolve(cursorPage(snapshots));
        await runtime.release();
      }
    },
  );
  test("keeps reverted calls out of older history reads", async () => {
    const launch = backgroundLaunch();
    let snapshots = [launch];
    let holdRead = false;
    const readingStarted = Promise.withResolvers<void>();
    const delayedHistory = Promise.withResolvers<Response>();
    const retracted = Promise.withResolvers<void>();
    const fixture = prepareFixture(({ url }) => {
      if (!url.pathname.endsWith("/message")) return undefined;
      if (!holdRead) return cursorPage(snapshots);
      holdRead = false;
      readingStarted.resolve();
      return delayedHistory.promise;
    });
    const runtime = await fixture.prepare();
    try {
      await runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "repository" } },
      ]);
      await runtime.startForwarding((signal) => {
        if (signal.type === "fault" || signal.type === "session_fault")
          retracted.reject(new Error(signal.message));
        if (
          signal.type === "session_event" &&
          signal.event.type === "transcript_retracted" &&
          signal.event.messageIds.includes(launch.id)
        )
          retracted.resolve();
      });
      holdRead = true;
      const reading = runtime.queries.loadSessionHistory(ref);
      await readingStarted.promise;
      snapshots = [];
      fixture.channel.push({
        id: "evt_revert_launch",
        type: "session.revert.committed",
        created: 8,
        durable,
        data: { sessionID: ref.externalSessionId, to: launch.id },
      });
      await retracted.promise;
      delayedHistory.resolve(cursorPage([launch]));
      expect(await reading).toEqual([]);
    } finally {
      delayedHistory.resolve(cursorPage([]));
      await runtime.release();
    }
  });
  test("keeps background subagents running until structured native completion", () => {
    const projector = new OpenCodeLiveMessageProjector();
    const message = backgroundLaunch();
    projector.seed([message]);
    expect(projectMessage(message).parts[0]).toMatchObject({
      kind: "subagent",
      status: "running",
      executionMode: "background",
      externalSessionId: "ses_child",
    });
    expect(projectMessage(message).parts[0]).not.toHaveProperty("endedAtMs");
    expect(
      projector.apply({
        id: "evt_child_complete",
        created: 9,
        type: "session.inbox.enqueued",
        durable,
        data: {
          sessionID: ref.externalSessionId,
          inboxID: "msg_child_complete",
          item: {
            type: "synthetic",
            delivery: "steer",
            payload: {
              text: "Native child result",
              description: "Research completed",
              metadata: {
                source: "subagent",
                childID: "ses_child",
                agent: "research",
                state: "completed",
              },
            },
          },
        },
      }),
    ).toEqual([]);
    const delivery: V2Event = {
      id: "evt_child_delivered",
      type: "session.inbox.delivered",
      created: 10,
      durable: { ...durable, seq: 2 },
      data: { sessionID: ref.externalSessionId, inboxID: "msg_child_complete" },
    };
    const events = projector.apply(delivery);
    expect(events.some((event) => event.type === "session_policy_notice")).toBe(false);
    const completed = events.find((event) => event.type === "assistant_part");
    expect(completed).toMatchObject({
      part: { partId: "call_child:subagent", status: "completed", endedAtMs: 10 },
    });
    expect(projectMessages([...projector.messages.values()])[0]?.parts[0]).toMatchObject({
      status: "completed",
      endedAtMs: 10,
    });
    expect(projectMessages([...projector.messages.values()])).toHaveLength(1);
    expect(projector.projectHistory([message])[0]?.parts[0]).toMatchObject({
      status: "completed",
      endedAtMs: 10,
    });
    expect(projector.apply(delivery)).toEqual([]);
    expect(projector.messages).toHaveProperty("size", 2);
  });
  test("links a continued child from complete input before progress arrives", () => {
    const projector = new OpenCodeLiveMessageProjector();
    const snapshot: SessionMessageInfo = {
      id: "msg_continuation",
      type: "assistant",
      time: { created: 2 },
      agent: "build",
      model,
      content: [
        {
          type: "tool",
          id: "call_continue",
          name: "subagent",
          time: { created: 3 },
          state: { status: "streaming", input: "" },
        },
      ],
    };
    projector.seed([snapshot]);
    projector.apply({
      id: "evt_continue_partial",
      type: "session.tool.input.delta",
      created: 3,
      data: {
        sessionID: ref.externalSessionId,
        assistantMessageID: snapshot.id,
        id: "call_continue",
        delta: '{"sessionID":"ses_child"',
      },
    });
    expect(projector.projectHistory([snapshot])[0]?.parts[0]).not.toHaveProperty(
      "externalSessionId",
    );
    const beforeTool = { ...snapshot, content: [] };
    expect(projector.projectHistory([beforeTool])[0]?.parts).toMatchObject([
      { kind: "subagent", status: "pending" },
    ]);
    projector.seed([beforeTool]);
    expect(projector.snapshotEvents(ref.externalSessionId)).toMatchObject([
      { type: "assistant_part", part: { kind: "subagent", status: "pending" } },
    ]);
    const events = projector.apply({
      id: "evt_continue_input",
      created: 4,
      type: "session.tool.input.ended",
      durable,
      data: {
        sessionID: ref.externalSessionId,
        assistantMessageID: "msg_continuation",
        id: "call_continue",
        text: JSON.stringify({
          sessionID: "ses_child",
          agent: "general",
          description: "Continue review",
          prompt: "Check changes",
        }),
      },
    });
    expect(events).toMatchObject([
      {
        part: {
          kind: "subagent",
          status: "pending",
          externalSessionId: "ses_child",
          agent: "general",
          description: "Continue review",
          prompt: "Check changes",
          executionMode: "foreground",
        },
      },
    ]);
    expect(events).toHaveLength(1);
    expect(projector.projectHistory([snapshot])[0]?.parts[0]).toMatchObject({
      kind: "subagent",
      status: "pending",
      externalSessionId: "ses_child",
      prompt: "Check changes",
    });
  });
  test("keeps the child link and cancelled state for an interrupted foreground tool", () => {
    const history = projectMessage({
      id: "msg_cancelled",
      type: "assistant",
      time: { created: 2 },
      agent: "build",
      model,
      content: [
        {
          type: "tool",
          id: "call_cancelled",
          name: "subagent",
          time: { created: 3, ran: 4, completed: 9 },
          state: {
            status: "error",
            input: { agent: "general", prompt: "Check changes" },
            error: { type: "aborted", message: "Interrupted by user" },
            metadata: { sessionID: "ses_child", status: "running" },
          },
        },
      ],
    });
    expect(history.parts).toMatchObject([
      {
        kind: "subagent",
        status: "cancelled",
        externalSessionId: "ses_child",
        endedAtMs: 9,
      },
    ]);
    expect(history.parts).toHaveLength(1);
  });
  test("drops reverted child results and restores them from a fresh snapshot", () => {
    const projector = new OpenCodeLiveMessageProjector();
    const launch = backgroundLaunch();
    const completion: SessionMessageInfo = {
      id: "msg_child_completion",
      type: "synthetic",
      time: { created: 9 },
      text: "Research completed",
      metadata: { source: "subagent", childID: "ses_child", state: "completed" },
    };
    const child = () =>
      projector
        .snapshotEvents(ref.externalSessionId)
        .find((event) => event.type === "assistant_part" && event.part.kind === "subagent");
    projector.seed([launch, completion]);
    expect(child()).toMatchObject({ part: { status: "completed", endedAtMs: 9 } });
    projector.apply({
      id: "evt_revert_child_completion",
      type: "session.revert.committed",
      created: 10,
      durable,
      data: { sessionID: ref.externalSessionId, to: completion.id },
    });
    expect(child()).toMatchObject({ part: { status: "running" } });
    expect(child()).not.toHaveProperty("part.endedAtMs");
    projector.seed([launch, completion]);
    expect(child()).toMatchObject({ part: { status: "completed", endedAtMs: 9 } });
  });

  test("keeps separate results for repeated calls to one child", () => {
    const launch = (id: string, at: number): SessionMessageInfo => ({
      id,
      type: "assistant",
      time: { created: at, completed: at + 2 },
      agent: "build",
      model,
      content: [
        {
          type: "tool",
          id: `call_${id}`,
          name: "subagent",
          time: { created: at, ran: at + 1, completed: at + 2 },
          state: {
            status: "completed",
            input: { background: true, sessionID: "ses_child" },
            content: [{ type: "text", text: "Started" }],
            metadata: { sessionID: "ses_child", status: "running" },
          },
        },
      ],
    });
    const completion = (
      id: string,
      at: number,
      state: "error" | "completed" | "cancelled",
    ): SessionMessageInfo => ({
      id,
      type: "synthetic",
      time: { created: at },
      text: `Native ${state} result`,
      metadata: { source: "subagent", childID: "ses_child", state },
    });
    const history = projectMessages([
      launch("first", 1),
      completion("failed", 5, "error"),
      launch("second", 7),
      completion("done", 12, "completed"),
      launch("third", 14),
      completion("cancelled", 18, "cancelled"),
    ]);
    expect(
      history.filter((message) => message.role === "assistant").map((message) => message.parts[0]),
    ).toMatchObject([
      { correlationKey: "call:call_first", status: "error", endedAtMs: 5 },
      { correlationKey: "call:call_second", status: "completed", endedAtMs: 12 },
      { correlationKey: "call:call_third", status: "cancelled", endedAtMs: 18 },
    ]);
  });
});

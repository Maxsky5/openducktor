import { describe, expect, test } from "bun:test";
import type { JsonValue, V2Event } from "@opencode/client";
import type { OpencodeSessionRuntimeSignal } from "./opencode-session-runtime-signals";
import { prepareFixture } from "./opencode-v2-live.test-support";
import {
  cursorPage,
  model,
  noContent,
  ref,
  response,
  session,
  type NativeRequest,
} from "./opencode-v2.test-support";

const CHILD = "ses_child";
const childRef = { ...ref, externalSessionId: CHILD };
const sessionScope = { kind: "repository" as const, workspaceId: "workspace-1" };

/** A runtime with an attached root conversation and its attached child conversation. */
const prepareTree = async (
  override?: (request: NativeRequest) => Response | Promise<Response> | undefined,
) => {
  const fixture = prepareFixture((request) => {
    const { url } = request;
    if (
      url.pathname === "/api/session" &&
      url.searchParams.get("parentID") === ref.externalSessionId
    )
      return cursorPage([session({ id: CHILD, parentID: ref.externalSessionId })]);
    if (url.pathname === `/api/session/${CHILD}`)
      return response(session({ id: CHILD, parentID: ref.externalSessionId }));
    return override?.(request);
  });
  const runtime = await fixture.prepare();
  const restored = await runtime.connection.readSessionSources(ref.repoPath, [
    { ...ref, sessionScope },
  ]);
  expect(restored.failures).toEqual([]);
  const signals: OpencodeSessionRuntimeSignal[] = [];
  const flushes = new Map<string, () => void>();
  await runtime.startForwarding((signal) => {
    if (signal.type === "runtime_notice") flushes.get(signal.message)?.();
    else signals.push(signal);
  });
  const seq = new Map<string, number>();
  let nextId = 0;
  const durable = (sessionID: string, version: 1 | 2 = 1) => {
    const next = (seq.get(sessionID) ?? 0) + 1;
    seq.set(sessionID, next);
    return { aggregateID: sessionID, seq: next, version } as const;
  };
  const push = (event: V2Event) => fixture.channel.push(event);
  const id = () => `evt_${++nextId}`;
  const events = {
    started: (sessionID: string) =>
      push({
        id: id(),
        type: "session.execution.started",
        created: nextId,
        durable: durable(sessionID),
        data: { sessionID },
      }),
    succeeded: (sessionID: string) =>
      push({
        id: id(),
        type: "session.execution.succeeded",
        created: nextId,
        durable: durable(sessionID),
        data: { sessionID },
      }),
    /** A tool call that completes while its work keeps running in the background. */
    backgroundCall: (
      sessionID: string,
      call: string,
      name: "shell" | "subagent",
      input: Record<string, JsonValue>,
      metadata: Record<string, JsonValue>,
    ) => {
      const assistantMessageID = `msg_${call}`;
      push({
        id: id(),
        type: "session.step.started",
        created: nextId,
        durable: durable(sessionID),
        data: { sessionID, assistantMessageID, agent: "build", model, started: nextId },
      });
      push({
        id: id(),
        type: "session.tool.input.started",
        created: nextId,
        durable: durable(sessionID),
        data: { sessionID, assistantMessageID, id: call, name },
      });
      push({
        id: id(),
        type: "session.tool.called",
        created: nextId,
        durable: durable(sessionID),
        data: { sessionID, assistantMessageID, id: call, input, executed: false },
      });
      push({
        id: id(),
        type: "session.tool.success",
        created: nextId,
        durable: durable(sessionID, 2),
        data: {
          sessionID,
          assistantMessageID,
          id: call,
          content: [{ type: "text", text: "Moved to the background" }],
          executed: false,
          metadata: { ...metadata, status: "running" },
        },
      });
    },
    /** The end of an execution that an interrupt stopped. */
    interrupted: (sessionID: string) =>
      push({
        id: id(),
        type: "session.execution.interrupted",
        created: nextId,
        durable: durable(sessionID),
        data: { sessionID, reason: "user" },
      }),
    notice: (sessionID: string, inboxID: string, payload: NoticePayload) =>
      push({
        id: id(),
        type: "session.inbox.enqueued",
        created: nextId,
        durable: durable(sessionID),
        data: {
          sessionID,
          inboxID,
          item: {
            type: "synthetic",
            delivery: "steer",
            payload,
          },
        },
      }),
    delivered: (sessionID: string, inboxID: string) =>
      push({
        id: id(),
        type: "session.inbox.delivered",
        created: nextId,
        durable: durable(sessionID),
        data: { sessionID, inboxID },
      }),
    cancelled: (sessionID: string, inboxID: string) =>
      push({
        id: id(),
        type: "session.inbox.cancelled",
        created: nextId,
        durable: durable(sessionID),
        data: { sessionID, inboxID },
      }),
  };
  /** Waits until the runtime handled every pushed event. */
  const flush = async () => {
    const message = `flush ${++nextId}`;
    const done = new Promise<void>((resolve) => flushes.set(message, resolve));
    push({ id: id(), type: "tui.toast.show", data: { message, variant: "warning" } });
    await done;
  };
  /** Takes the signals since the last call. */
  const take = () => signals.splice(0);
  return { fixture, runtime, events, flush, take };
};

type TreeEvents = Awaited<ReturnType<typeof prepareTree>>["events"];

/** OpenCode stops the running execution of the conversation, then sends its end event. */
const interruptReply = (events: TreeEvents, url: URL) => {
  events.interrupted(url.pathname.split("/").at(-2)!);
  return Response.json({ interrupted: true });
};

const lifecycle = (signals: OpencodeSessionRuntimeSignal[]) =>
  signals.flatMap((signal) => {
    if (signal.type === "background_updated")
      return [
        {
          background: signal.externalSessionId,
          tasks: signal.tasks.map((task) => task.taskId),
          resultPending: signal.resultPending,
        },
      ];
    if (signal.type === "session_fault") return [{ fault: signal.message }];
    if (signal.type !== "session_event") return [];
    const { event } = signal;
    if (event.type === "session_turn_finished")
      return [{ turnFinished: event.externalSessionId, outcome: event.turnOutcome }];
    if (event.type === "session_idle")
      return [{ idle: event.externalSessionId, outcome: event.turnOutcome }];
    if (event.type === "session_status")
      return [
        {
          status: event.externalSessionId,
          type: event.status.type,
          foreground: event.foregroundTurnActive,
        },
      ];
    return [];
  });

type NoticePayload = {
  text: string;
  description?: string;
  metadata: Record<string, JsonValue>;
};

/** The notice of `ShellResult.notification` in OpenCode 2.2.5. */
const shellNotice = (
  shellID: string,
  command: string,
  state: "completed" | "error" = "completed",
): NoticePayload => ({
  text: `<shell id="${shellID}" state="${state}" command="${command}">\nDone\n</shell>`,
  description: command,
  metadata: { source: "shell", shellID, jobID: shellID, state },
});

describe("OpenCode background tasks", () => {
  test("keeps the session running after its reply until the shell result reaches the agent", async () => {
    const { runtime, events, flush, take } = await prepareTree();
    try {
      events.started(ref.externalSessionId);
      events.backgroundCall(
        ref.externalSessionId,
        "call_dev",
        "shell",
        { command: "bun run dev", background: true },
        { shellID: "sh_dev", truncated: false },
      );
      await flush();
      const started = take();
      expect(lifecycle(started)).toEqual([
        { status: ref.externalSessionId, type: "busy", foreground: undefined },
        { background: ref.externalSessionId, tasks: ["shell:sh_dev"], resultPending: false },
      ]);
      expect(started.find((signal) => signal.type === "background_updated")).toMatchObject({
        tasks: [
          {
            taskId: "shell:sh_dev",
            kind: "command",
            title: "bun run dev",
            stop: { allowed: true },
          },
        ],
      });

      events.succeeded(ref.externalSessionId);
      await flush();
      expect(lifecycle(take())).toEqual([
        { turnFinished: ref.externalSessionId, outcome: "completed" },
      ]);

      events.notice(ref.externalSessionId, "msg_dev_done", shellNotice("sh_dev", "bun run dev"));
      await flush();
      expect(lifecycle(take())).toEqual([
        { background: ref.externalSessionId, tasks: [], resultPending: true },
      ]);

      events.delivered(ref.externalSessionId, "msg_dev_done");
      await flush();
      expect(lifecycle(take())).toEqual([
        { background: ref.externalSessionId, tasks: [], resultPending: false },
        { idle: ref.externalSessionId, outcome: undefined },
      ]);
    } finally {
      await runtime.release();
    }
  });

  test("marks a reply that the task result starts as a foreground turn", async () => {
    const { runtime, events, flush, take } = await prepareTree();
    try {
      events.backgroundCall(
        ref.externalSessionId,
        "call_build",
        "shell",
        { command: "bun run build" },
        { shellID: "sh_build", truncated: false },
      );
      events.notice(
        ref.externalSessionId,
        "msg_build_done",
        shellNotice("sh_build", "bun run build"),
      );
      await flush();
      take();
      events.started(ref.externalSessionId);
      events.delivered(ref.externalSessionId, "msg_build_done");
      events.succeeded(ref.externalSessionId);
      await flush();
      expect(lifecycle(take())).toEqual([
        { status: ref.externalSessionId, type: "busy", foreground: true },
        { background: ref.externalSessionId, tasks: [], resultPending: false },
        { idle: ref.externalSessionId, outcome: "completed" },
      ]);
    } finally {
      await runtime.release();
    }
  });

  test("lists the subagent task and the tasks of the child on the parent, oldest first", async () => {
    const { runtime, events, flush, take } = await prepareTree();
    try {
      events.backgroundCall(
        ref.externalSessionId,
        "call_research",
        "subagent",
        { agent: "research", description: "Find references", prompt: "Find references" },
        { sessionID: CHILD },
      );
      events.backgroundCall(
        CHILD,
        "call_watch",
        "shell",
        { command: "bun test --watch" },
        { shellID: "sh_watch", truncated: false },
      );
      await flush();
      const updates = take().filter((signal) => signal.type === "background_updated");
      expect(updates.at(-1)).toEqual({
        type: "background_updated",
        externalSessionId: ref.externalSessionId,
        tasks: [
          {
            taskId: `subagent:${CHILD}:call_research`,
            kind: "subagent",
            title: "research",
            description: "Find references",
            stop: { allowed: true },
          },
          {
            taskId: "shell:sh_watch",
            kind: "command",
            title: "bun test --watch",
            stop: { allowed: true },
          },
        ],
        resultPending: false,
      });
      expect(updates.at(-2)).toMatchObject({
        externalSessionId: CHILD,
        tasks: [{ taskId: "shell:sh_watch" }],
      });

      // The subagent result goes to the parent. The child shell still runs.
      events.notice(ref.externalSessionId, "msg_research_done", {
        text: `<subagent sessionID="${CHILD}" state="completed" description="Find references">\nFound\n</subagent>`,
        description: "Find references",
        metadata: { source: "subagent", childID: CHILD, agent: "research", state: "completed" },
      });
      events.delivered(ref.externalSessionId, "msg_research_done");
      await flush();
      expect(lifecycle(take()).at(-1)).toEqual({
        background: ref.externalSessionId,
        tasks: ["shell:sh_watch"],
        resultPending: false,
      });
    } finally {
      await runtime.release();
    }
  });

  test("tracks a continued subagent again, and ignores the start of a task that already ended", async () => {
    const { runtime, events, flush, take } = await prepareTree();
    const research = {
      text: `<subagent sessionID="${CHILD}" state="completed">\nFound\n</subagent>`,
      metadata: { source: "subagent", childID: CHILD, agent: "research", state: "completed" },
    };
    const callResearch = (call: string) =>
      events.backgroundCall(
        ref.externalSessionId,
        call,
        "subagent",
        { agent: "research", prompt: "Find references" },
        { sessionID: CHILD },
      );
    try {
      callResearch("call_first");
      events.notice(ref.externalSessionId, "msg_first_done", research);
      events.delivered(ref.externalSessionId, "msg_first_done");
      // The agent continues the same child in the background.
      callResearch("call_again");
      await flush();
      expect(lifecycle(take()).at(-1)).toEqual({
        background: ref.externalSessionId,
        tasks: [`subagent:${CHILD}:call_again`],
        resultPending: false,
      });

      // A fast shell sends its notice before its start, and the agent gets it before the start.
      events.notice(ref.externalSessionId, "msg_fast_done", shellNotice("sh_fast", "ls"));
      events.delivered(ref.externalSessionId, "msg_fast_done");
      events.backgroundCall(
        ref.externalSessionId,
        "call_fast",
        "shell",
        { command: "ls" },
        { shellID: "sh_fast", truncated: false },
      );
      await flush();
      expect(lifecycle(take()).filter((entry) => "background" in entry)).toEqual([]);
    } finally {
      await runtime.release();
    }
  });

  test("keeps the result of a task whose notice arrives before its start pending until delivery", async () => {
    const { runtime, events, flush, take } = await prepareTree();
    try {
      // OpenCode starts the completion observer of a shell before it returns the tool result.
      events.started(ref.externalSessionId);
      events.notice(ref.externalSessionId, "msg_fast_done", shellNotice("sh_fast", "ls"));
      events.backgroundCall(
        ref.externalSessionId,
        "call_fast",
        "shell",
        { command: "ls" },
        { shellID: "sh_fast", truncated: false },
      );
      events.succeeded(ref.externalSessionId);
      await flush();
      expect(lifecycle(take())).toEqual([
        { status: ref.externalSessionId, type: "busy", foreground: undefined },
        { background: ref.externalSessionId, tasks: [], resultPending: true },
        { turnFinished: ref.externalSessionId, outcome: "completed" },
      ]);

      events.delivered(ref.externalSessionId, "msg_fast_done");
      await flush();
      expect(lifecycle(take())).toEqual([
        { background: ref.externalSessionId, tasks: [], resultPending: false },
        { idle: ref.externalSessionId, outcome: undefined },
      ]);
    } finally {
      await runtime.release();
    }
  });

  test("reports a malformed notice of a known source as unavailable status", async () => {
    const { runtime, events, flush, take } = await prepareTree();
    try {
      events.notice(ref.externalSessionId, "msg_bad", {
        text: "Subagent ended",
        metadata: { source: "subagent", state: "completed" },
      });
      await flush();
      const fault = take().find((signal) => signal.type === "session_fault");
      expect(fault).toMatchObject({
        externalSessionId: ref.externalSessionId,
        statusUnavailable: true,
        backgroundTrackingLost: true,
      });
      expect(fault?.type === "session_fault" && fault.message).toContain(
        "OpenCode sent an invalid subagent notice",
      );
    } finally {
      await runtime.release();
    }
  });

  test("stops one task only inside the session tree of the ref", async () => {
    let shellRemoval: Response = noContent();
    const { fixture, runtime, events, flush } = await prepareTree(({ url, method }) => {
      if (method === "DELETE" && url.pathname.startsWith("/api/shell/")) return shellRemoval;
      if (url.pathname.endsWith("/interrupt")) return Response.json({ interrupted: true });
      return undefined;
    });
    const stops = () =>
      fixture.requests
        .filter(
          ({ url, method }) =>
            (method === "DELETE" && url.pathname.startsWith("/api/shell/")) ||
            url.pathname.endsWith("/interrupt"),
        )
        .map(({ url }) => `${url.pathname}?${url.searchParams}`);
    try {
      events.backgroundCall(
        ref.externalSessionId,
        "call_research",
        "subagent",
        { agent: "research", prompt: "Find references" },
        { sessionID: CHILD },
      );
      events.backgroundCall(
        CHILD,
        "call_watch",
        "shell",
        { command: "bun test --watch" },
        { shellID: "sh_watch", truncated: false },
      );
      await flush();

      // The subagent task belongs to the parent, so the child tree does not contain it.
      await runtime.connection.stopBackgroundTask({
        ...childRef,
        taskId: `subagent:${CHILD}:call_research`,
      });
      await runtime.connection.stopBackgroundTask({ ...ref, taskId: "shell:sh_unknown" });
      expect(stops()).toEqual([]);

      await runtime.connection.stopBackgroundTask({ ...ref, taskId: "shell:sh_watch" });
      await runtime.connection.stopBackgroundTask({
        ...ref,
        taskId: `subagent:${CHILD}:call_research`,
      });
      expect(stops()).toEqual([
        "/api/shell/sh_watch?location%5Bdirectory%5D=%2Frepo",
        `/api/session/${CHILD}/interrupt?`,
      ]);

      shellRemoval = Response.json({ message: "shell service failed" }, { status: 500 });
      const failed = await runtime.connection
        .stopBackgroundTask({ ...ref, taskId: "shell:sh_watch" })
        .catch((cause: unknown) => cause);
      expect(String(failed)).toContain("OpenCode could not stop a background task");

      // A failure after the task ended is success.
      events.notice(CHILD, "msg_watch_done", shellNotice("sh_watch", "bun test --watch"));
      await flush();
      await runtime.connection.stopBackgroundTask({ ...ref, taskId: "shell:sh_watch" });
    } finally {
      await runtime.release();
    }
  });

  test("rejects a one-task stop with the reason after the adapter lost the tracking of the tree", async () => {
    const { fixture, runtime, events, flush } = await prepareTree();
    try {
      events.backgroundCall(
        ref.externalSessionId,
        "call_dev",
        "shell",
        { command: "bun run dev" },
        { shellID: "sh_dev", truncated: false },
      );
      events.notice(ref.externalSessionId, "msg_dev_done", {
        text: "Done",
        metadata: { source: "shell", shellID: "sh_dev", state: "stopped" },
      });
      await flush();

      const failed = await runtime.connection
        .stopBackgroundTask({ ...ref, taskId: "shell:sh_dev" })
        .catch((cause: unknown) => cause);
      expect(String(failed)).toContain("OpenCode could not stop a background task");
      expect(String(failed)).toContain("OpenCode sent an invalid shell notice");
      expect(
        fixture.requests
          .filter(({ method }) => method !== "GET")
          .map(({ method, url }) => `${method} ${url.pathname}`),
      ).toEqual([]);
    } finally {
      await runtime.release();
    }
  });

  test("rejects a one-task stop when the child is released during a failed request, and keeps the parent lost", async () => {
    const { fixture, runtime, events, flush, take } = await prepareTree(({ url, method }) => {
      if (method === "DELETE" && url.pathname === "/api/shell/sh_build")
        return runtime.connection
          .releaseSession(childRef)
          .then(() => Response.json({ message: "shell service failed" }, { status: 500 }));
      if (url.pathname.endsWith("/interrupt")) return interruptReply(events, url);
      return undefined;
    });
    const lost = `The conversation '${CHILD}' was released while these background tasks still ran: 'bun run build'. OpenDucktor cannot confirm that they ended, so the status of the parent conversations is unavailable. Check the tasks, then restart the runtime.`;
    try {
      events.backgroundCall(
        CHILD,
        "call_build",
        "shell",
        { command: "bun run build" },
        { shellID: "sh_build", truncated: false },
      );
      await flush();
      take();

      const failed = await runtime.connection
        .stopBackgroundTask({ ...ref, taskId: "shell:sh_build" })
        .catch((cause: unknown) => cause);
      expect(String(failed)).toContain("OpenCode could not stop a background task");
      await flush();
      const signals = take();
      expect(lifecycle(signals)).toEqual([
        // The loss comes first, so the parent never shows Idle while the work is unknown.
        { fault: lost },
        { background: ref.externalSessionId, tasks: [], resultPending: false },
      ]);
      expect(signals.find((signal) => signal.type === "session_fault")).toMatchObject({
        externalSessionId: ref.externalSessionId,
        statusUnavailable: true,
        backgroundTrackingLost: true,
      });

      const removals = () =>
        fixture.requests.filter(
          ({ method, url }) => method === "DELETE" && url.pathname.startsWith("/api/shell/"),
        );
      const retry = await runtime.connection
        .stopBackgroundTask({ ...ref, taskId: "shell:sh_build" })
        .catch((cause: unknown) => cause);
      expect(String(retry)).toContain(lost);
      const stopSession = await runtime.connection
        .stopSession(ref)
        .catch((cause: unknown) => cause);
      expect(String(stopSession)).toContain(lost);
      expect(removals()).toHaveLength(1);
    } finally {
      await runtime.release();
    }
  });

  test("keeps a released grandchild's loss on the root when the intermediate child is released", async () => {
    const GRANDCHILD = "ses_grandchild";
    const { fixture, runtime, events, flush, take } = await prepareTree(({ url }) => {
      if (url.pathname === "/api/session" && url.searchParams.get("parentID") === CHILD)
        return cursorPage([session({ id: GRANDCHILD, parentID: CHILD })]);
      if (url.pathname === `/api/session/${GRANDCHILD}`)
        return response(session({ id: GRANDCHILD, parentID: CHILD }));
      if (url.pathname.endsWith("/interrupt")) return Response.json({ interrupted: false });
      return undefined;
    });
    const lost = `The conversation '${GRANDCHILD}' was released while these background tasks still ran: 'bun run build'. OpenDucktor cannot confirm that they ended, so the status of the parent conversations is unavailable. Check the tasks, then restart the runtime.`;
    const removals = () =>
      fixture.requests.filter(
        ({ method, url }) => method === "DELETE" && url.pathname.startsWith("/api/shell/"),
      );
    try {
      events.backgroundCall(
        GRANDCHILD,
        "call_build",
        "shell",
        { command: "bun run build" },
        { shellID: "sh_build", truncated: false },
      );
      await flush();
      expect(lifecycle(take()).at(-1)).toEqual({
        background: ref.externalSessionId,
        tasks: ["shell:sh_build"],
        resultPending: false,
      });

      await runtime.connection.releaseSession({ ...ref, externalSessionId: GRANDCHILD });
      await flush();
      expect(take().find((signal) => signal.type === "session_fault")).toMatchObject({
        externalSessionId: CHILD,
        message: lost,
        backgroundTrackingLost: true,
      });
      const first = await runtime.connection.stopSession(ref).catch((cause: unknown) => cause);
      expect(String(first)).toContain(lost);

      await runtime.connection.releaseSession(childRef);
      await flush();
      const signals = take();
      expect(lifecycle(signals)).toEqual([
        // The loss comes first, so the parent never shows Idle while the work is unknown.
        { fault: lost },
        { background: ref.externalSessionId, tasks: [], resultPending: false },
      ]);
      expect(signals.find((signal) => signal.type === "session_fault")).toMatchObject({
        externalSessionId: ref.externalSessionId,
        statusUnavailable: true,
        backgroundTrackingLost: true,
      });
      const retry = await runtime.connection.stopSession(ref).catch((cause: unknown) => cause);
      expect(String(retry)).toContain(lost);
      expect(removals()).toEqual([]);
    } finally {
      await runtime.release();
    }
  });

  test("makes the parent status unavailable when a released child leaves an undelivered result", async () => {
    const { fixture, runtime, events, flush, take } = await prepareTree(({ url }) =>
      url.pathname.endsWith("/interrupt") ? Response.json({ interrupted: false }) : undefined,
    );
    const lost = `The conversation '${CHILD}' was released while 1 background task result was not delivered. OpenDucktor cannot confirm that they ended, so the status of the parent conversations is unavailable. Check the tasks, then restart the runtime.`;
    try {
      events.backgroundCall(
        CHILD,
        "call_build",
        "shell",
        { command: "bun run build" },
        { shellID: "sh_build", truncated: false },
      );
      events.notice(CHILD, "msg_build_done", shellNotice("sh_build", "bun run build"));
      await flush();
      expect(lifecycle(take()).at(-1)).toEqual({
        background: ref.externalSessionId,
        tasks: [],
        resultPending: true,
      });

      await runtime.connection.releaseSession(childRef);
      await flush();
      const signals = take();
      expect(lifecycle(signals)).toEqual([
        // The loss comes first, so the parent never shows Idle while the work is unknown.
        { fault: lost },
        { background: ref.externalSessionId, tasks: [], resultPending: false },
      ]);
      expect(signals.find((signal) => signal.type === "session_fault")).toMatchObject({
        externalSessionId: ref.externalSessionId,
        statusUnavailable: true,
        backgroundTrackingLost: true,
      });
      const failed = await runtime.connection.stopSession(ref).catch((cause: unknown) => cause);
      expect(String(failed)).toContain(lost);
      expect(
        fixture.requests
          .filter(({ method }) => method !== "GET")
          .map(({ method, url }) => `${method} ${url.pathname}`),
      ).toEqual([`POST /api/session/${ref.externalSessionId}/interrupt`]);
    } finally {
      await runtime.release();
    }
  });

  test("ignores a stop of an ended subagent run and keeps the run that continues its child", async () => {
    const { fixture, runtime, events, flush, take } = await prepareTree(({ url }) =>
      url.pathname.endsWith("/interrupt") ? Response.json({ interrupted: true }) : undefined,
    );
    const interrupts = () =>
      fixture.requests.filter(({ url }) => url.pathname.endsWith("/interrupt")).length;
    const callResearch = (call: string) =>
      events.backgroundCall(
        ref.externalSessionId,
        call,
        "subagent",
        { agent: "research", prompt: "Find references" },
        { sessionID: CHILD },
      );
    try {
      callResearch("call_first");
      events.notice(ref.externalSessionId, "msg_first_done", {
        text: `<subagent sessionID="${CHILD}" state="completed">\nFound\n</subagent>`,
        metadata: { source: "subagent", childID: CHILD, agent: "research", state: "completed" },
      });
      events.delivered(ref.externalSessionId, "msg_first_done");
      callResearch("call_again");
      await flush();
      take();

      // The confirmation of a stop of the first run arrives after the run ended.
      await runtime.connection.stopBackgroundTask({
        ...ref,
        taskId: `subagent:${CHILD}:call_first`,
      });
      await flush();
      expect(interrupts()).toBe(0);
      expect(take()).toEqual([]);

      await runtime.connection.stopBackgroundTask({
        ...ref,
        taskId: `subagent:${CHILD}:call_again`,
      });
      expect(interrupts()).toBe(1);
    } finally {
      await runtime.release();
    }
  });

  test("stops every task of the tree and cancels undelivered results", async () => {
    let push!: (sessionID: string, inboxID: string, shellID: string) => void;
    const { fixture, runtime, events, flush, take } = await prepareTree(({ url, method }) => {
      if (method === "DELETE" && url.pathname === "/api/shell/sh_dev") {
        // OpenCode fails the job of a removed shell and sends its notice.
        push(ref.externalSessionId, "msg_dev_done", "sh_dev");
        return noContent();
      }
      if (method === "DELETE" && url.pathname.includes("/inbox/")) {
        events.cancelled(ref.externalSessionId, url.pathname.split("/").at(-1)!);
        return noContent();
      }
      if (url.pathname.endsWith("/interrupt")) return interruptReply(events, url);
      return undefined;
    });
    push = (sessionID, inboxID, shellID) =>
      events.notice(sessionID, inboxID, shellNotice(shellID, "bun run dev", "error"));
    try {
      events.backgroundCall(
        ref.externalSessionId,
        "call_lint",
        "shell",
        { command: "bun run lint" },
        { shellID: "sh_lint", truncated: false },
      );
      events.notice(ref.externalSessionId, "msg_lint_done", shellNotice("sh_lint", "bun run lint"));
      events.backgroundCall(
        ref.externalSessionId,
        "call_dev",
        "shell",
        { command: "bun run dev" },
        { shellID: "sh_dev", truncated: false },
      );
      await flush();
      take();
      const from = fixture.requests.length;
      await runtime.connection.stopSession(ref);
      expect(
        fixture.requests
          .slice(from)
          .filter(({ method }) => method !== "GET")
          .map(({ method, url }) => `${method} ${url.pathname}`),
      ).toEqual([
        `POST /api/session/${ref.externalSessionId}/interrupt`,
        "DELETE /api/shell/sh_dev",
        `DELETE /api/session/${ref.externalSessionId}/inbox/msg_lint_done`,
        `DELETE /api/session/${ref.externalSessionId}/inbox/msg_dev_done`,
      ]);
      await flush();
      expect(lifecycle(take()).at(-1)).toEqual({ idle: ref.externalSessionId, outcome: undefined });
    } finally {
      await runtime.release();
    }
  });

  test("stops a task that a woken conversation starts while Stop session waits", async () => {
    let events!: TreeEvents;
    const tree = await prepareTree(({ url, method }) => {
      if (method === "DELETE" && url.pathname.startsWith("/api/shell/")) {
        const shellID = url.pathname.split("/").at(-1)!;
        events.notice(CHILD, `msg_${shellID}_done`, shellNotice(shellID, shellID, "error"));
        // The first result wakes the child, and its reply starts a new task before the second
        // result arrives.
        if (shellID === "sh_one") {
          events.started(CHILD);
          events.delivered(CHILD, "msg_sh_one_done");
          events.backgroundCall(
            CHILD,
            "call_replacement",
            "shell",
            { command: "sh_replacement" },
            { shellID: "sh_replacement", truncated: false },
          );
        }
        return noContent();
      }
      if (method === "DELETE" && url.pathname.includes("/inbox/")) {
        events.cancelled(CHILD, url.pathname.split("/").at(-1)!);
        return noContent();
      }
      if (url.pathname.endsWith("/interrupt")) return interruptReply(events, url);
      return undefined;
    });
    events = tree.events;
    const { fixture, runtime, flush, take } = tree;
    try {
      for (const shellID of ["sh_one", "sh_two"])
        events.backgroundCall(
          CHILD,
          `call_${shellID}`,
          "shell",
          { command: shellID },
          { shellID, truncated: false },
        );
      await flush();
      take();
      const from = fixture.requests.length;
      await runtime.connection.stopSession(ref);
      const requests = fixture.requests
        .slice(from)
        .filter(({ method }) => method !== "GET")
        .map(({ method, url }) => `${method} ${url.pathname}`);
      expect(requests.filter((request) => request.startsWith("DELETE /api/shell/"))).toEqual([
        "DELETE /api/shell/sh_one",
        "DELETE /api/shell/sh_two",
        "DELETE /api/shell/sh_replacement",
      ]);
      // The result that the child takes interrupts the reply that it starts.
      expect(
        requests.filter((request) => request === `POST /api/session/${CHILD}/interrupt`),
      ).toHaveLength(1);
      await flush();
      expect(
        lifecycle(take())
          .filter((item) => "background" in item)
          .at(-1),
      ).toEqual({
        background: ref.externalSessionId,
        tasks: [],
        resultPending: false,
      });
    } finally {
      await runtime.release();
    }
  });

  test("fails Stop session when the tree keeps starting tasks, and keeps the last task", async () => {
    let events!: TreeEvents;
    const tree = await prepareTree(({ url, method }) => {
      if (method === "DELETE" && url.pathname.startsWith("/api/shell/")) {
        // The conversation starts the next task before the stopped one ends.
        const shellID = url.pathname.split("/").at(-1)!;
        const next = `sh_${Number(shellID.slice(3)) + 1}`;
        events.backgroundCall(
          ref.externalSessionId,
          `call_${next}`,
          "shell",
          { command: `watch ${next}` },
          { shellID: next, truncated: false },
        );
        events.notice(ref.externalSessionId, `msg_${shellID}_done`, shellNotice(shellID, shellID));
        return noContent();
      }
      if (url.pathname.endsWith("/interrupt")) return interruptReply(events, url);
      return undefined;
    });
    events = tree.events;
    const { fixture, runtime, flush, take } = tree;
    try {
      events.backgroundCall(
        ref.externalSessionId,
        "call_sh_0",
        "shell",
        { command: "watch sh_0" },
        { shellID: "sh_0", truncated: false },
      );
      await flush();
      take();
      const failed = await runtime.connection.stopSession(ref).catch((cause: unknown) => cause);
      expect(String(failed)).toContain(
        "The conversation started background tasks again after 3 stop rounds: watch sh_3.",
      );
      expect(
        fixture.requests.filter(
          ({ method, url }) => method === "DELETE" && url.pathname.startsWith("/api/shell/"),
        ),
      ).toHaveLength(3);
      await flush();
      expect(
        lifecycle(take())
          .filter((item) => "background" in item)
          .at(-1),
      ).toEqual({
        background: ref.externalSessionId,
        tasks: ["shell:sh_3"],
        resultPending: true,
      });
    } finally {
      await runtime.release();
    }
  });

  test("waits for the end of the interrupted reply before Stop session checks the tree", async () => {
    let answered!: () => void;
    const answer = new Promise<void>((resolve) => {
      answered = resolve;
    });
    let rootInterrupts = 0;
    const { fixture, runtime, events, flush, take } = await prepareTree(({ url, method }) => {
      if (method === "DELETE" && url.pathname === "/api/shell/sh_late") {
        events.notice(
          ref.externalSessionId,
          "msg_late_done",
          shellNotice("sh_late", "bun run dev", "error"),
        );
        return noContent();
      }
      if (method === "DELETE" && url.pathname.includes("/inbox/")) {
        events.cancelled(ref.externalSessionId, url.pathname.split("/").at(-1)!);
        return noContent();
      }
      if (url.pathname === `/api/session/${ref.externalSessionId}/interrupt`) {
        rootInterrupts += 1;
        if (rootInterrupts > 1) return interruptReply(events, url);
        // The answer comes before the events of the reply that the interrupt stops.
        answered();
        return Response.json({ interrupted: true });
      }
      return undefined;
    });
    try {
      events.started(ref.externalSessionId);
      await flush();
      take();
      let stopped = false;
      const stopping = runtime.connection.stopSession(ref).then(() => {
        stopped = true;
      });
      await answer;
      await flush();
      expect(stopped).toBe(false);

      // The reply started a background shell before its interruption.
      events.backgroundCall(
        ref.externalSessionId,
        "call_late",
        "shell",
        { command: "bun run dev" },
        { shellID: "sh_late", truncated: false },
      );
      events.interrupted(ref.externalSessionId);
      await stopping;
      expect(
        fixture.requests
          .filter(
            ({ method, url }) => method === "DELETE" && url.pathname.startsWith("/api/shell/"),
          )
          .map(({ url }) => url.pathname),
      ).toEqual(["/api/shell/sh_late"]);
      await flush();
      expect(
        lifecycle(take())
          .filter((item) => "background" in item)
          .at(-1),
      ).toEqual({
        background: ref.externalSessionId,
        tasks: [],
        resultPending: false,
      });
    } finally {
      await runtime.release();
    }
  });

  test("fails Stop session when the runtime is released before the interrupted reply ends", async () => {
    let answered!: () => void;
    const answer = new Promise<void>((resolve) => {
      answered = resolve;
    });
    const { runtime, events, flush } = await prepareTree(({ url }) => {
      if (!url.pathname.endsWith("/interrupt")) return undefined;
      answered();
      return Response.json({ interrupted: true });
    });
    events.started(ref.externalSessionId);
    await flush();
    const stopping = runtime.connection.stopSession(ref).catch((cause: unknown) => cause);
    await answer;
    await runtime.release();
    const failed = await stopping;
    expect(String(failed)).toContain("OpenCode could not stop the background tasks");
    expect(String(failed)).toContain("The OpenCode runtime was released.");
  });

  test("fails Stop session when the runtime is released before the wait for the stopped task starts", async () => {
    let release!: () => Promise<void>;
    const { runtime, events, flush } = await prepareTree(({ url, method }) => {
      if (method === "DELETE" && url.pathname === "/api/shell/sh_dev") {
        // The release comes after OpenCode removed the shell, before its notice arrives.
        void release();
        return noContent();
      }
      if (url.pathname.endsWith("/interrupt")) return interruptReply(events, url);
      return undefined;
    });
    release = () => runtime.release();
    events.backgroundCall(
      ref.externalSessionId,
      "call_dev",
      "shell",
      { command: "bun run dev" },
      { shellID: "sh_dev", truncated: false },
    );
    await flush();
    const failed = await runtime.connection.stopSession(ref).catch((cause: unknown) => cause);
    expect(String(failed)).toContain("OpenCode could not stop the background tasks");
    expect(String(failed)).toContain("The OpenCode runtime was released.");
  });

  test("fails Stop session when the child is released before the wait for its stopped task starts", async () => {
    let releaseChild!: () => Promise<void>;
    const { runtime, events, flush } = await prepareTree(({ url, method }) => {
      if (method === "DELETE" && url.pathname === "/api/shell/sh_build")
        return releaseChild().then(noContent);
      if (url.pathname.endsWith("/interrupt")) return interruptReply(events, url);
      return undefined;
    });
    releaseChild = () => runtime.connection.releaseSession(childRef);
    try {
      events.backgroundCall(
        CHILD,
        "call_build",
        "shell",
        { command: "bun run build" },
        { shellID: "sh_build", truncated: false },
      );
      await flush();
      const failed = await runtime.connection.stopSession(ref).catch((cause: unknown) => cause);
      expect(String(failed)).toContain("OpenCode could not stop the background tasks");
      expect(String(failed)).toContain(`The conversation '${CHILD}' was released.`);
    } finally {
      await runtime.release();
    }
  });

  test("fails Stop session with the runtime reason and keeps the task", async () => {
    const { runtime, events, flush, take } = await prepareTree(({ url, method }) => {
      if (method === "DELETE" && url.pathname === "/api/shell/sh_dev")
        return Response.json({ message: "shell service failed" }, { status: 500 });
      if (url.pathname.endsWith("/interrupt")) return interruptReply(events, url);
      return undefined;
    });
    try {
      events.backgroundCall(
        ref.externalSessionId,
        "call_dev",
        "shell",
        { command: "bun run dev" },
        { shellID: "sh_dev", truncated: false },
      );
      await flush();
      take();
      const failed = await runtime.connection.stopSession(ref).catch((cause: unknown) => cause);
      expect(String(failed)).toContain("OpenCode could not stop a background task");
      await flush();
      expect(lifecycle(take()).filter((item) => "background" in item)).toEqual([]);
    } finally {
      await runtime.release();
    }
  });

  test("stops a task that a conversation starts when it takes a result during its cancellation", async () => {
    let events!: TreeEvents;
    let childInterrupts = 0;
    const tree = await prepareTree(({ url, method }) => {
      if (method === "DELETE" && url.pathname.startsWith("/api/shell/")) {
        const shellID = url.pathname.split("/").at(-1)!;
        events.notice(CHILD, `msg_${shellID}_done`, shellNotice(shellID, shellID, "error"));
        return noContent();
      }
      if (method === "DELETE" && url.pathname === `/api/session/${CHILD}/inbox/msg_sh_build_done`) {
        // The child woke before the cancellation, took the result, and started a new task. The
        // reply then ended by itself. OpenCode answers the cancellation conflict with success.
        events.started(CHILD);
        events.delivered(CHILD, "msg_sh_build_done");
        events.backgroundCall(
          CHILD,
          "call_replacement",
          "shell",
          { command: "sh_replacement" },
          { shellID: "sh_replacement", truncated: false },
        );
        events.succeeded(CHILD);
        return noContent();
      }
      if (method === "DELETE" && url.pathname.includes("/inbox/")) {
        events.cancelled(CHILD, url.pathname.split("/").at(-1)!);
        return noContent();
      }
      if (url.pathname === `/api/session/${CHILD}/interrupt`) {
        childInterrupts += 1;
        // The first interrupt comes before the child runs.
        if (childInterrupts === 1) return Response.json({ interrupted: false });
        return interruptReply(events, url);
      }
      if (url.pathname.endsWith("/interrupt")) return interruptReply(events, url);
      return undefined;
    });
    events = tree.events;
    const { fixture, runtime, flush, take } = tree;
    try {
      events.backgroundCall(
        CHILD,
        "call_build",
        "shell",
        { command: "sh_build" },
        { shellID: "sh_build", truncated: false },
      );
      await flush();
      take();
      await runtime.connection.stopSession(ref);
      expect(
        fixture.requests
          .filter(
            ({ method, url }) => method === "DELETE" && url.pathname.startsWith("/api/shell/"),
          )
          .map(({ url }) => url.pathname),
      ).toEqual(["/api/shell/sh_build", "/api/shell/sh_replacement"]);
      await flush();
      expect(
        lifecycle(take())
          .filter((item) => "background" in item)
          .at(-1),
      ).toEqual({
        background: ref.externalSessionId,
        tasks: [],
        resultPending: false,
      });
    } finally {
      await runtime.release();
    }
  });

  test.each([
    ["after", false],
    ["before", true],
  ])(
    "fails Stop session with the reason when the end notice of a stopped task is unreadable, %s the removal answer",
    async (_order, noticeFirst) => {
      let removed!: () => void;
      const removal = new Promise<void>((resolve) => {
        removed = resolve;
      });
      const { runtime, events, flush, take } = await prepareTree(({ url, method }) => {
        if (method === "DELETE" && url.pathname === "/api/shell/sh_dev") {
          if (noticeFirst) unreadableNotice();
          removed();
          return noContent();
        }
        if (url.pathname.endsWith("/interrupt")) return interruptReply(events, url);
        return undefined;
      });
      const unreadableNotice = () =>
        events.notice(ref.externalSessionId, "msg_dev_done", {
          text: "Done",
          metadata: { source: "shell", shellID: "sh_dev", state: "stopped" },
        });
      try {
        events.backgroundCall(
          ref.externalSessionId,
          "call_dev",
          "shell",
          { command: "bun run dev" },
          { shellID: "sh_dev", truncated: false },
        );
        await flush();
        take();
        const stopping = runtime.connection.stopSession(ref).catch((cause: unknown) => cause);
        await removal;
        await flush();
        if (!noticeFirst) unreadableNotice();
        const failed = await stopping;
        expect(String(failed)).toContain("OpenCode could not stop the background tasks");
        expect(String(failed)).toContain("OpenCode sent an invalid shell notice");
        await flush();
        const signals = take();
        expect(signals.find((signal) => signal.type === "session_fault")).toMatchObject({
          externalSessionId: ref.externalSessionId,
          statusUnavailable: true,
          backgroundTrackingLost: true,
        });
        // The task end is not confirmed, so the task stays in the list.
        expect(lifecycle(signals).filter((item) => "background" in item)).toEqual([]);
      } finally {
        await runtime.release();
      }
    },
  );

  test.each([
    ["while the root interrupt request is in flight", true],
    ["before Stop session", false],
  ])(
    "interrupts a reply that a task result starts %s, and waits for its end",
    async (_when, duringRootInterrupt) => {
      let received!: () => void;
      const rootInterruptReceived = new Promise<void>((resolve) => {
        received = resolve;
      });
      let answer!: () => void;
      const rootAnswer = new Promise<void>((resolve) => {
        answer = resolve;
      });
      const { fixture, runtime, events, flush, take } = await prepareTree(({ url }) => {
        if (url.pathname === `/api/session/${ref.externalSessionId}/interrupt`) {
          received();
          return rootAnswer.then(() => Response.json({ interrupted: false }));
        }
        // The answer comes before the end event of the stopped reply.
        if (url.pathname === `/api/session/${CHILD}/interrupt`)
          return Response.json({ interrupted: true });
        return undefined;
      });
      /** The child shell ends, and its result starts a reply of the child. */
      const childTakesResult = async () => {
        events.notice(CHILD, "msg_build_done", shellNotice("sh_build", "bun run build"));
        events.started(CHILD);
        events.delivered(CHILD, "msg_build_done");
        await flush();
      };
      try {
        events.backgroundCall(
          CHILD,
          "call_build",
          "shell",
          { command: "bun run build" },
          { shellID: "sh_build", truncated: false },
        );
        await flush();
        if (!duringRootInterrupt) await childTakesResult();
        take();
        let stopped = false;
        const stopping = runtime.connection.stopSession(ref).then(() => {
          stopped = true;
        });
        await rootInterruptReceived;
        if (duringRootInterrupt) await childTakesResult();
        else await flush();
        // The child reply is interrupted while the root interrupt request is in flight.
        expect(
          fixture.requests
            .filter(({ method }) => method === "POST")
            .map(({ url }) => url.pathname)
            .filter((path) => path.endsWith("/interrupt"))
            .toSorted(),
        ).toEqual([
          `/api/session/${CHILD}/interrupt`,
          `/api/session/${ref.externalSessionId}/interrupt`,
        ]);
        answer();
        await flush();
        // The reply of the child still runs.
        expect(stopped).toBe(false);
        events.interrupted(CHILD);
        await stopping;
        await flush();
        expect(lifecycle(take()).at(-1)).toEqual({ idle: CHILD, outcome: "interrupted" });
      } finally {
        await runtime.release();
      }
    },
  );

  test("fails Stop session when the adapter lost the background tracking of a session of the tree", async () => {
    const { fixture, runtime, events, flush, take } = await prepareTree(({ url }) => {
      if (url.pathname.endsWith("/interrupt")) return Response.json({ interrupted: false });
      return undefined;
    });
    try {
      // A running shell result with no shell ID gives no task and no notice to wait for.
      events.backgroundCall(
        CHILD,
        "call_dev",
        "shell",
        { command: "bun run dev" },
        { truncated: false },
      );
      await flush();
      expect(take().find((signal) => signal.type === "session_fault")).toMatchObject({
        externalSessionId: CHILD,
        backgroundTrackingLost: true,
      });
      const failed = await runtime.connection.stopSession(ref).catch((cause: unknown) => cause);
      expect(String(failed)).toContain("OpenCode could not stop the background tasks");
      expect(String(failed)).toContain("OpenCode sent an invalid background shell result");
      expect(
        fixture.requests
          .filter(({ method }) => method !== "GET")
          .map(({ method, url }) => `${method} ${url.pathname}`),
      ).toEqual([`POST /api/session/${ref.externalSessionId}/interrupt`]);
    } finally {
      await runtime.release();
    }
  });
});

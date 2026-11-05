import { describe, expect, test } from "bun:test";
import {
  encodeHostChannelFrame,
  hostChannelRequestSchema,
  type HostChannelMessage,
  type HostChannelRequestMessage,
  type NotificationStreamFrame,
  type TaskEventStreamFrame,
} from "@openducktor/contracts";
import {
  createHostChannelSession,
  HostChannelProtocolError,
  HostChannelRequestError,
  type HostChannelEvent,
  type HostChannelHandlers,
} from "./channel";

const boundary = { epoch: "00000000-0000-4000-8000-000000000002", sequence: 3 };
const subscriptionId = "00000000-0000-4000-8000-000000000009";
const snapshot: TaskEventStreamFrame = {
  type: "snapshot_required",
  cursor: boundary,
  reason: "buffer_gap",
};

const setup = (handlers: Partial<HostChannelHandlers> = {}) => {
  const sent: HostChannelRequestMessage[] = [];
  const handlerErrors: unknown[] = [];
  const session = createHostChannelSession({
    send: (frame) =>
      sent.push(hostChannelRequestSchema.parse(JSON.parse(new TextDecoder().decode(frame)))),
    handlers: { hostEvent: () => {}, notification: () => {}, ...handlers },
    onHandlerError: (cause) => handlerErrors.push(cause),
  });
  const receive = (header: HostChannelMessage, body?: string) =>
    session.receive(encodeHostChannelFrame(header, body));
  return { session, sent, handlerErrors, receive };
};

const settled = async <T>(promise: Promise<T>) => {
  try {
    return { value: await promise };
  } catch (cause) {
    return { cause };
  }
};

describe("createHostChannelSession", () => {
  test("sends a request with a new ID and resolves with the result body", async () => {
    const { session, sent, receive } = setup();
    const first = session.request({ method: "invoke", command: "git_check", args: {} });
    const second = session.request({ method: "remote_access.observe" });
    expect(sent.map(({ id, method }) => ({ id, method }))).toEqual([
      { id: 0, method: "invoke" },
      { id: 1, method: "remote_access.observe" },
    ]);
    receive({ type: "result", id: 1 });
    receive({ type: "result", id: 0 }, JSON.stringify({ gitOk: true }));
    expect(await first).toEqual({ gitOk: true });
    expect(await second).toBeNull();
  });

  test.each([
    [{ kind: "host", response: { error: "failed", message: "Git failed." } }, "Git failed."],
    [
      {
        kind: "refused",
        failure: { code: "remote_disabled", message: "Disabled.", nextAction: "Enable it." },
      },
      "Disabled. Enable it.",
    ],
    [{ kind: "reply_too_large", limitBytes: 32 * 1024 * 1024 }, "larger than 32 MiB"],
  ] as const)("an error reply rejects with HostChannelRequestError", async (error, message) => {
    const { session, receive } = setup();
    const request = session.request({ method: "invoke", command: "git_check", args: {} });
    receive({ type: "error", id: 0, error });
    const result = await settled(request);
    expect(result.cause).toBeInstanceOf(HostChannelRequestError);
    expect(result.cause).toMatchObject({ error, message: expect.stringContaining(message) });
  });

  test("an abort rejects at once and drops the later reply", async () => {
    const { session, receive } = setup();
    const caller = new AbortController();
    const request = session.request(
      { method: "invoke", command: "git_check", args: {} },
      caller.signal,
    );
    const reason = new Error("Timed out.");
    caller.abort(reason);
    expect((await settled(request)).cause).toBe(reason);
    expect(() => receive({ type: "result", id: 0 }, "true")).not.toThrow();
  });

  test("an aborted signal sends nothing", async () => {
    const { session, sent } = setup();
    const caller = new AbortController();
    caller.abort(new Error("Closed."));
    const result = await settled(
      session.request({ method: "invoke", command: "git_check", args: {} }, caller.signal),
    );
    expect(result.cause).toBe(caller.signal.reason);
    expect(sent).toEqual([]);
  });

  test("close rejects pending and later requests with its cause", async () => {
    const { session, sent } = setup();
    const pending = session.request({ method: "invoke", command: "git_check", args: {} });
    const lost = new Error("The host channel closed.");
    session.close(lost);
    session.close(new Error("A second close is ignored."));
    expect((await settled(pending)).cause).toBe(lost);
    expect((await settled(session.request({ method: "remote_access.observe" }))).cause).toBe(lost);
    expect(sent).toHaveLength(1);
  });

  test("a send failure rejects the request", async () => {
    const failure = new Error("The socket is not open.");
    const session = createHostChannelSession({
      send: () => {
        throw failure;
      },
      handlers: { hostEvent: () => {}, notification: () => {} },
      onHandlerError: () => {},
    });
    expect((await settled(session.request({ method: "remote_access.observe" }))).cause).toBe(
      failure,
    );
  });

  test("a task lease receives the frames that follow its result in the same turn", async () => {
    const { session, receive } = setup();
    const frames: TaskEventStreamFrame[] = [];
    const lease = session.subscribeTaskEvents({ cursor: null }, (frame) => frames.push(frame));
    receive(
      { type: "result", id: 0 },
      JSON.stringify({ subscriptionId, replayBoundary: boundary }),
    );
    receive({ type: "task_frame", subscriptionId, frame: snapshot });
    expect(frames).toEqual([snapshot]);
    expect(await lease).toEqual({ subscriptionId, replayBoundary: boundary });
  });

  test("an invalid task lease fails the subscription and the frame", async () => {
    const { session, receive } = setup();
    const lease = session.subscribeTaskEvents({ cursor: null }, () => {});
    expect(() => receive({ type: "result", id: 0 }, JSON.stringify({ wrong: true }))).toThrow(
      HostChannelProtocolError,
    );
    expect((await settled(lease)).cause).toBeInstanceOf(HostChannelProtocolError);
  });

  test("an attached lease receives frames, and a release stops local delivery at once", async () => {
    const { session, sent, receive } = setup();
    const frames: TaskEventStreamFrame[] = [];
    const attached = session.attachTaskEvents(subscriptionId, (frame) => frames.push(frame));
    receive({ type: "result", id: 0 });
    await attached;
    receive({ type: "task_frame", subscriptionId, frame: snapshot });
    const released = session.releaseTaskEvents(subscriptionId);
    receive({ type: "task_frame", subscriptionId, frame: snapshot });
    receive({ type: "result", id: 1 });
    await released;
    expect(frames).toEqual([snapshot]);
    expect(sent.map(({ method }) => method)).toEqual(["task_events.attach", "task_events.release"]);
  });

  test("a host event decodes its body only when a reader asks for it", () => {
    const events: HostChannelEvent[] = [];
    const { session } = setup({ hostEvent: (event) => events.push(event) });
    const header = encodeHostChannelFrame({ type: "host_event", id: 5, name: "message" });
    const frame = new Uint8Array([...header, 0x0a, 0xff]);
    session.receive(frame);
    expect(events.map(({ id, name }) => ({ id, name }))).toEqual([{ id: 5, name: "message" }]);
    expect(() => events[0]!.body()).toThrow(HostChannelProtocolError);
  });

  test("a host event body decodes once", () => {
    const bodies: string[] = [];
    const { receive } = setup({
      hostEvent: (event) => {
        bodies.push(event.body(), event.body());
      },
    });
    receive({ type: "host_event", id: 1, name: "message" }, '{"channel":"x"}');
    expect(bodies).toEqual(['{"channel":"x"}', '{"channel":"x"}']);
  });

  test("handler failures go to onHandlerError and keep the session", async () => {
    const failure = new Error("The view failed.");
    const frames: NotificationStreamFrame[] = [];
    const { session, receive, handlerErrors } = setup({
      notification: (frame) => {
        frames.push(frame);
        throw failure;
      },
    });
    const frame: NotificationStreamFrame = {
      type: "attached",
      cursor: { epoch: "00000000-0000-4000-8000-000000000001", sequence: 0 },
      reason: "new",
      health: [],
    };
    receive({ type: "notification", frame });
    expect(handlerErrors).toEqual([failure]);
    const request = session.request({ method: "remote_access.observe" });
    receive({ type: "result", id: 0 });
    expect(await request).toBeNull();
    expect(frames).toEqual([frame]);
  });

  test.each([
    ["an invalid header", new TextEncoder().encode("{broken")],
    ["an unknown message type", new TextEncoder().encode('{"type":"surprise"}')],
    ["invalid UTF-8", new Uint8Array([0xff])],
    [
      "an event without a body",
      encodeHostChannelFrame({ type: "host_event", id: 1, name: "message" }),
    ],
  ])("%s throws HostChannelProtocolError", (_name, frame) => {
    const { session } = setup();
    expect(() => session.receive(frame)).toThrow(HostChannelProtocolError);
  });

  test("an invalid result body fails its request and the frame", async () => {
    const { session } = setup();
    const request = session.request({ method: "remote_access.observe" });
    const header = encodeHostChannelFrame({ type: "result", id: 0 });
    const frame = new Uint8Array([...header, 0x0a, ...new TextEncoder().encode("{")]);
    expect(() => session.receive(frame)).toThrow(HostChannelProtocolError);
    expect((await settled(request)).cause).toBeInstanceOf(HostChannelProtocolError);
  });
});

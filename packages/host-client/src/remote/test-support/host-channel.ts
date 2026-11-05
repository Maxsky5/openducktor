import {
  encodeHostChannelFrame,
  hostChannelRequestSchema,
  type HostChannelError,
  type HostCommandInputRecord,
  type HostChannelMessage,
  type HostChannelRequestMessage,
  type HostEventEnvelope,
  type NotificationCursor,
  type NotificationStreamFrame,
  type RemoteAccessState,
  type TaskEventCursor,
  type TaskEventStreamFrame,
} from "@openducktor/contracts";

/** What a fake host answers to one request: a result, an error, or nothing yet. */
export type FakeHostChannelReply = { result: unknown } | { error: HostChannelError } | "none";

/** One host event in the fake replay buffer. */
export type FakeHostEvent = { id: number; name: string; envelope: HostEventEnvelope };

export type FakeHostChannelOptions = {
  /** The epoch of the fake host process. A cursor of another epoch replays nothing. */
  hostEpoch?: string;
  /** The answer to a command. The default result is null. */
  invoke?(
    command: string,
    args: HostCommandInputRecord,
    request: HostChannelRequestMessage,
  ): FakeHostChannelReply | Promise<FakeHostChannelReply>;
  /** The answer to any request. Return undefined for the default answer. */
  answer?(
    request: HostChannelRequestMessage,
    socket: FakeHostChannelSocket,
  ): FakeHostChannelReply | undefined;
  /** The cursor of the `attached` notification frame that follows `events.open`. */
  notificationCursor?: NotificationCursor;
  /** The replay boundary of each task lease. */
  taskBoundary?: TaskEventCursor;
  /** Frames that the host sends after each new task lease. */
  initialTaskFrames?(boundary: TaskEventCursor): TaskEventStreamFrame[];
  /** The protocol that the host selects. The default is the first offered protocol. */
  selectProtocol?(protocols: string[]): string;
  /** Closes the socket before it opens. */
  refuse?(protocols: string[]): boolean;
};

/** The host end of one fake socket. */
export type FakeHostChannelSocket = {
  readonly protocols: string[];
  readonly requests: HostChannelRequestMessage[];
  readonly closed: boolean;
  send(header: HostChannelMessage, body?: string): void;
  /** Closes the socket from the host. */
  close(): void;
};

/** The client end of a fake socket. Its handlers take the event fields that clients read. */
export class FakeClientSocket {
  binaryType: "blob" | "arraybuffer" = "blob";
  protocol = "";
  readyState: WebSocket["readyState"] = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data?: ArrayBuffer | string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(
    private readonly onSend: (data: Uint8Array) => void,
    private readonly onClose: () => void,
  ) {}

  send(data: Parameters<WebSocket["send"]>[0]): void {
    if (this.readyState !== 1) throw new Error("The fake socket is not open.");
    if (!(data instanceof Uint8Array)) throw new Error("The channel sends binary frames.");
    this.onSend(data);
  }

  close(): void {
    this.onClose();
  }
}

const later = (work: () => void) => setTimeout(work, 0);

/**
 * An in-memory host channel for client tests. It answers the channel protocol with defaults that
 * each test can replace, and it delivers every frame in a later task, as a network does.
 */
export const createFakeHostChannel = (options: FakeHostChannelOptions = {}) => {
  const hostEpoch = options.hostEpoch ?? "fake-host-epoch";
  const notificationCursor = options.notificationCursor ?? {
    epoch: "00000000-0000-4000-8000-000000000001",
    sequence: 0,
  };
  const taskBoundary = options.taskBoundary ?? {
    epoch: "00000000-0000-4000-8000-000000000002",
    sequence: 0,
  };
  const events: FakeHostEvent[] = [];
  const sockets: FakeHostChannelSocket[] = [];
  const requests: HostChannelRequestMessage[] = [];
  const leases = new Map<string, FakeHostChannelSocket>();
  let nextEventId = 0;

  const createSocket = (protocols: string[]): FakeClientSocket => {
    const socketRequests: HostChannelRequestMessage[] = [];
    const deliverClose = () => {
      if (client.readyState === 3) return;
      client.readyState = 3;
      later(() => client.onclose?.());
    };
    const host: FakeHostChannelSocket = {
      protocols,
      requests: socketRequests,
      get closed() {
        return client.readyState === 3;
      },
      send(header, body) {
        if (client.readyState !== 1) return;
        const frame = encodeHostChannelFrame(header, body);
        later(() => {
          if (client.readyState === 1) client.onmessage?.({ data: frame.slice().buffer });
        });
      },
      close: () => deliverClose(),
    };
    const reply = (request: HostChannelRequestMessage, answer: FakeHostChannelReply) => {
      if (answer === "none") return;
      if ("error" in answer) host.send({ type: "error", id: request.id, error: answer.error });
      else host.send({ type: "result", id: request.id }, JSON.stringify(answer.result ?? null));
    };
    const handle = async (request: HostChannelRequestMessage) => {
      const custom = options.answer?.(request, host);
      if (custom !== undefined) {
        reply(request, custom);
        return;
      }
      switch (request.method) {
        case "events.open": {
          const previous = request.cursor;
          const hostChanged = previous !== null && previous.hostEpoch !== hostEpoch;
          if (previous && !hostChanged)
            for (const event of events)
              if (event.id > previous.hostEventId)
                host.send(
                  { type: "host_event", id: event.id, name: event.name },
                  JSON.stringify(event.envelope),
                );
          reply(request, {
            result: { hostEpoch, hostEventId: nextEventId, hostChanged, gaps: [] },
          });
          host.send({
            type: "notification",
            frame: { type: "attached", cursor: notificationCursor, reason: "new", health: [] },
          });
          return;
        }
        case "invoke":
          reply(
            request,
            options.invoke
              ? await options.invoke(request.command, request.args, request)
              : { result: null },
          );
          return;
        case "task_events.subscribe": {
          const subscriptionId = crypto.randomUUID();
          leases.set(subscriptionId, host);
          reply(request, { result: { subscriptionId, replayBoundary: taskBoundary } });
          for (const frame of options.initialTaskFrames?.(taskBoundary) ?? [])
            host.send({ type: "task_frame", subscriptionId, frame });
          return;
        }
        case "task_events.attach":
          if (!leases.has(request.subscriptionId)) {
            reply(request, {
              error: {
                kind: "refused",
                failure: {
                  code: "connection_expired",
                  message: "Task subscription is expired.",
                  nextAction: "Create a task subscription on this connection.",
                },
              },
            });
            return;
          }
          leases.set(request.subscriptionId, host);
          reply(request, { result: null });
          return;
        case "task_events.release":
          leases.delete(request.subscriptionId);
          reply(request, { result: null });
          return;
        default:
          reply(request, { result: null });
      }
    };
    const client = new FakeClientSocket((data) => {
      const request = hostChannelRequestSchema.parse(JSON.parse(new TextDecoder().decode(data)));
      socketRequests.push(request);
      requests.push(request);
      later(() => {
        if (client.readyState === 1) void handle(request);
      });
    }, deliverClose);
    later(() => {
      if (client.readyState !== 0) return;
      if (options.refuse?.(protocols)) {
        deliverClose();
        return;
      }
      client.readyState = 1;
      client.protocol = options.selectProtocol?.(protocols) ?? protocols[0] ?? "";
      sockets.push(host);
      client.onopen?.();
    });
    return client;
  };

  const openSockets = () => sockets.filter((socket) => !socket.closed);

  return {
    /** Creates the client end of a new socket. Pass it to `openWebSocket` or `openRemoteSocket`. */
    createSocket,
    /** Every socket that opened, in order. */
    sockets,
    /** Every request of every socket, in order. */
    requests,
    /** Retains a host event and sends it to every socket with open events. */
    emit(envelope: HostEventEnvelope, name = "message"): FakeHostEvent {
      nextEventId += 1;
      const event = { id: nextEventId, name, envelope };
      events.push(event);
      for (const socket of openSockets())
        if (socket.requests.some((request) => request.method === "events.open"))
          socket.send({ type: "host_event", id: event.id, name }, JSON.stringify(envelope));
      return event;
    },
    notify(frame: NotificationStreamFrame): void {
      for (const socket of openSockets()) socket.send({ type: "notification", frame });
    },
    /** Sends a frame to the socket that holds the lease. */
    taskFrame(subscriptionId: string, frame: TaskEventStreamFrame): void {
      leases.get(subscriptionId)?.send({ type: "task_frame", subscriptionId, frame });
    },
    remoteAccessState(state: RemoteAccessState): void {
      for (const socket of openSockets()) socket.send({ type: "remote_access_state", state });
    },
    /** Forgets every lease, as a restarted host does. */
    dropLeases(): void {
      leases.clear();
    },
    /** Closes every open socket from the host. */
    closeAll(): void {
      for (const socket of openSockets()) socket.close();
    },
  };
};

export type FakeHostChannel = ReturnType<typeof createFakeHostChannel>;

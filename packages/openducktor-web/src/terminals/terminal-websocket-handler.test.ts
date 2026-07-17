import { describe, expect, test } from "bun:test";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
} from "@openducktor/contracts";
import {
  createTerminalService,
  type FilesystemPort,
  type TerminalPtyPort,
  type TerminalService,
  TerminalServiceError,
} from "@openducktor/host";
import { Effect } from "effect";
import { type TerminalWebSocketData, terminalWebSocketHandler } from "./terminal-websocket-handler";

const makeSocket = (
  terminalService: TerminalService,
  sendStatus?: (frame: Uint8Array) => number,
) => {
  const sent: Uint8Array[] = [];
  const closed: Array<[number, string]> = [];
  const socket = {
    data: {
      connectionId: "connection-1",
      terminalService,
      clientSession: null,
      backpressured: false,
      inFlightBytes: 0,
      pendingBytes: 0,
      pendingFrames: [],
      logger: {
        error: () => Effect.void,
        info: () => Effect.void,
        success: () => Effect.void,
      },
      onBackgroundFailure: () => undefined,
    } satisfies TerminalWebSocketData,
    send: (frame: Uint8Array) => {
      sent.push(frame);
      return sendStatus?.(frame) ?? frame.byteLength;
    },
    close: (code: number, reason: string) => closed.push([code, reason]),
  };
  return { socket: socket as never, sent, closed, data: socket.data };
};

describe("terminalWebSocketHandler", () => {
  test("multiplexes attach, input, resize, ACK, and detach by opaque terminal id", async () => {
    const operations: string[] = [];
    const service = {
      attach: (input: Parameters<TerminalService["attach"]>[0]) =>
        Effect.sync(() => {
          operations.push(`attach:${input.terminalId}:${input.attachmentId}`);
          input.sink(
            {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "snapshot",
              terminalId: input.terminalId,
              earliestRetainedSequence: 0,
              snapshotSequenceEnd: 0,
              lifecycle: "running",
              title: "~/repo",
              complete: true,
            },
            new Uint8Array(),
          );
        }),
      write: (terminalId: string, payload: Uint8Array) =>
        Effect.sync(() => operations.push(`write:${terminalId}:${payload[0]}`)),
      resize: (terminalId: string, grid: { columns: number; rows: number }) =>
        Effect.sync(() => operations.push(`resize:${terminalId}:${grid.columns}x${grid.rows}`)),
      acknowledge: (terminalId: string, attachmentId: string, sequenceEnd: number) =>
        Effect.sync(() => operations.push(`ack:${terminalId}:${attachmentId}:${sequenceEnd}`)),
      detach: (terminalId: string, attachmentId: string) =>
        Effect.sync(() => operations.push(`detach:${terminalId}:${attachmentId}`)),
    } as unknown as TerminalService;
    const harness = makeSocket(service);
    const send = (
      message: Parameters<typeof encodeTerminalProtocolFrame>[0]["message"],
      payload = new Uint8Array(),
    ) =>
      terminalWebSocketHandler.message(
        harness.socket,
        Buffer.from(encodeTerminalProtocolFrame({ message, payload })),
      );
    for (const terminalId of ["terminal-1", "terminal-2"]) {
      send({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "attach",
        terminalId,
        lastConsumedSequence: null,
      });
    }
    send(
      { version: TERMINAL_PROTOCOL_VERSION, type: "input", terminalId: "terminal-1" },
      new Uint8Array([65]),
    );
    send({
      version: TERMINAL_PROTOCOL_VERSION,
      type: "resize",
      terminalId: "terminal-2",
      columns: 120,
      rows: 40,
    });
    send({
      version: TERMINAL_PROTOCOL_VERSION,
      type: "ack",
      terminalId: "terminal-1",
      sequenceEnd: 0,
    });
    send({ version: TERMINAL_PROTOCOL_VERSION, type: "detach", terminalId: "terminal-2" });
    await Bun.sleep(0);

    expect(operations).toEqual([
      "attach:terminal-1:browser:connection-1:terminal-1",
      "attach:terminal-2:browser:connection-1:terminal-2",
      "write:terminal-1:65",
      "resize:terminal-2:120x40",
      "ack:terminal-1:browser:connection-1:terminal-1:0",
      "detach:terminal-2:browser:connection-1:terminal-2",
    ]);
    expect(
      harness.sent.map((frame) => decodeTerminalProtocolFrame(frame).message.terminalId),
    ).toEqual(["terminal-1", "terminal-2"]);
  });

  test("preserves client frame order while attach is asynchronous", async () => {
    const operations: string[] = [];
    let attached = false;
    const terminalService = {
      attach: () =>
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                attached = true;
                operations.push("attach");
                resolve();
              }, 10);
            }),
        ),
      acknowledge: () => Effect.sync(() => operations.push(attached ? "ack" : "ack-before-attach")),
    } as unknown as TerminalService;
    const harness = makeSocket(terminalService);
    const send = (message: Parameters<typeof encodeTerminalProtocolFrame>[0]["message"]): void => {
      terminalWebSocketHandler.message(
        harness.socket,
        Buffer.from(encodeTerminalProtocolFrame({ message, payload: new Uint8Array() })),
      );
    };

    send({
      version: TERMINAL_PROTOCOL_VERSION,
      type: "attach",
      terminalId: "terminal-1",
      lastConsumedSequence: null,
    });
    send({
      version: TERMINAL_PROTOCOL_VERSION,
      type: "ack",
      terminalId: "terminal-1",
      sequenceEnd: 0,
    });
    await Bun.sleep(20);

    expect(operations).toEqual(["attach", "ack"]);
  });

  test("reports unknown terminal ids and rejects oversized frames", async () => {
    const service = {
      write: (terminalId: string) =>
        Effect.fail(
          new TerminalServiceError({
            code: "terminal_not_found",
            operation: "write",
            message: `Terminal not found: ${terminalId}`,
            terminalId,
          }),
        ),
    } as unknown as TerminalService;
    const unknown = makeSocket(service);
    terminalWebSocketHandler.message(
      unknown.socket,
      Buffer.from(
        encodeTerminalProtocolFrame({
          message: {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "input",
            terminalId: "missing",
          },
          payload: new Uint8Array([1]),
        }),
      ),
    );
    await Bun.sleep(0);
    expect(decodeTerminalProtocolFrame(unknown.sent[0] ?? new Uint8Array()).message).toMatchObject({
      type: "protocol_error",
      terminalId: "missing",
      failure: { code: "terminal_not_found" },
    });

    const oversized = makeSocket(service);
    terminalWebSocketHandler.message(oversized.socket, Buffer.alloc(1024 * 1024 + 1));
    expect(oversized.closed).toEqual([[1009, "Invalid terminal frame."]]);
  });

  test("does not retain failed terminal attachments", async () => {
    const service = {
      attach: ({ terminalId }: Parameters<TerminalService["attach"]>[0]) =>
        Effect.fail(
          new TerminalServiceError({
            code: "terminal_not_found",
            operation: "attach",
            message: `Terminal not found: ${terminalId}`,
            terminalId,
          }),
        ),
    } as unknown as TerminalService;
    const harness = makeSocket(service);

    for (let index = 0; index < 100; index += 1) {
      terminalWebSocketHandler.message(
        harness.socket,
        Buffer.from(
          encodeTerminalProtocolFrame({
            message: {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "attach",
              terminalId: `missing-${index}`,
              lastConsumedSequence: null,
            },
            payload: new Uint8Array(),
          }),
        ),
      );
    }
    await Bun.sleep(10);

    expect(harness.data.clientSession).not.toBeNull();
    expect(harness.sent.map((frame) => decodeTerminalProtocolFrame(frame).message)).toHaveLength(
      100,
    );
    expect(
      harness.sent.every((frame) => {
        const message = decodeTerminalProtocolFrame(frame).message;
        return message.type === "protocol_error" && message.failure.code === "terminal_forgotten";
      }),
    ).toBe(true);
  });

  test("reports a stale attach from the real terminal service as forgotten", async () => {
    const service = await Effect.runPromise(
      createTerminalService({
        filesystem: {} as FilesystemPort,
        ptyPort: {} as TerminalPtyPort,
        resolveLaunchEnvironment: () =>
          Effect.succeed({ shell: "/bin/sh", args: [], env: { PATH: "/usr/bin" } }),
        hostInstanceIdFactory: () => "host-1",
      }),
    );
    const harness = makeSocket(service);

    terminalWebSocketHandler.message(
      harness.socket,
      Buffer.from(
        encodeTerminalProtocolFrame({
          message: {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "attach",
            terminalId: "missing",
            lastConsumedSequence: null,
          },
          payload: new Uint8Array(),
        }),
      ),
    );
    await Bun.sleep(0);

    expect(harness.data.clientSession).not.toBeNull();
    expect(harness.sent).toHaveLength(1);
    expect(decodeTerminalProtocolFrame(harness.sent[0] ?? new Uint8Array()).message).toMatchObject({
      type: "protocol_error",
      terminalId: "missing",
      failure: { code: "terminal_forgotten" },
    });
  });

  test("closes instead of growing the outbound queue past its byte bound", async () => {
    const payload = new Uint8Array(700 * 1024);
    const service = {
      attach: (input: Parameters<TerminalService["attach"]>[0]) =>
        Effect.sync(() => {
          for (let index = 0; index < 3; index += 1) {
            input.sink(
              {
                version: TERMINAL_PROTOCOL_VERSION,
                type: "output",
                terminalId: input.terminalId,
                sequenceStart: index * payload.byteLength,
                sequenceEnd: (index + 1) * payload.byteLength,
                replay: false,
              },
              payload,
            );
          }
        }),
    } as unknown as TerminalService;
    const harness = makeSocket(service, () => -1);
    terminalWebSocketHandler.message(
      harness.socket,
      Buffer.from(
        encodeTerminalProtocolFrame({
          message: {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "attach",
            terminalId: "terminal-1",
            lastConsumedSequence: null,
          },
          payload: new Uint8Array(),
        }),
      ),
    );
    await Bun.sleep(10);
    expect(harness.closed).toContainEqual([1013, "Terminal outbound queue limit exceeded."]);
    expect(harness.data.pendingBytes).toBeLessThanOrEqual(700 * 1024 + 256);
  });
  test("rejects text and server-directed frames", () => {
    const harness = makeSocket({} as TerminalService);
    terminalWebSocketHandler.message(harness.socket, "text");
    expect(harness.closed[0]?.[0]).toBe(1003);

    const second = makeSocket({} as TerminalService);
    terminalWebSocketHandler.message(
      second.socket,
      Buffer.from(
        encodeTerminalProtocolFrame({
          message: {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "terminal_forgotten",
            terminalId: "terminal-1",
          },
          payload: new Uint8Array(),
        }),
      ),
    );
    expect(second.closed[0]?.[0]).toBe(1002);
  });

  test("detaches every multiplexed terminal when the socket closes", async () => {
    const detached: string[] = [];
    const service = {
      attach: () => Effect.void,
      detach: (terminalId: string) => Effect.sync(() => detached.push(terminalId)),
    } as unknown as TerminalService;
    const harness = makeSocket(service);
    for (const terminalId of ["terminal-1", "terminal-2"]) {
      terminalWebSocketHandler.message(
        harness.socket,
        Buffer.from(
          encodeTerminalProtocolFrame({
            message: {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "attach",
              terminalId,
              lastConsumedSequence: null,
            },
            payload: new Uint8Array(),
          }),
        ),
      );
    }
    await Bun.sleep(0);
    terminalWebSocketHandler.close?.(harness.socket, 1000, "done");
    await Bun.sleep(0);
    expect(detached.sort()).toEqual(["terminal-1", "terminal-2"]);
    expect(harness.data.clientSession).toBeNull();
  });
});

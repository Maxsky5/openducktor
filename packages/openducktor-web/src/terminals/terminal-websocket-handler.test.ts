import { describe, expect, test } from "bun:test";
import { encodeTerminalProtocolFrame, TERMINAL_PROTOCOL_VERSION } from "@openducktor/contracts";
import type { TerminalService } from "@openducktor/host";
import { Effect } from "effect";
import { type TerminalWebSocketData, terminalWebSocketHandler } from "./terminal-websocket-handler";

const makeSocket = (terminalService: TerminalService) => {
  const sent: Uint8Array[] = [];
  const closed: Array<[number, string]> = [];
  const socket = {
    data: {
      connectionId: "connection-1",
      terminalService,
      attachments: new Set<string>(),
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
      return frame.byteLength;
    },
    close: (code: number, reason: string) => closed.push([code, reason]),
  };
  return { socket: socket as never, sent, closed, data: socket.data };
};

describe("terminalWebSocketHandler", () => {
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
      detach: (terminalId: string) => Effect.sync(() => detached.push(terminalId)),
    } as unknown as TerminalService;
    const harness = makeSocket(service);
    harness.data.attachments.add("terminal-1");
    harness.data.attachments.add("terminal-2");
    terminalWebSocketHandler.close?.(harness.socket, 1000, "done");
    await Promise.resolve();
    expect(detached.sort()).toEqual(["terminal-1", "terminal-2"]);
    expect(harness.data.attachments.size).toBe(0);
  });
});

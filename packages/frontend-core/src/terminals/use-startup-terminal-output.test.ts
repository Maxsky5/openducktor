import { expect, test } from "bun:test";
import {
  decodeTerminalProtocolFrame,
  isTerminalClientMessage,
  type TerminalClientMessage,
} from "@openducktor/contracts";
import { createTestClientConnection } from "../test-support/test-client-connection";
import type { TerminalBridge } from "./terminal-bridge";
import { acquireTerminalTransport } from "./terminal-transport-pool";
import { acquireStartupTerminalOutput } from "./use-startup-terminal-output";

test("startup output has its own replay cursor and sends no input or resize on attachment or reconnect", async () => {
  const connection = createTestClientConnection();
  const streams: { frames: TerminalClientMessage[]; disconnect: () => void }[] = [];
  const attached = Promise.withResolvers<void>();
  const reattached = Promise.withResolvers<void>();
  let recoveryRegistrations = 0;
  const bridge: TerminalBridge = {
    subscribeRecovery: () => {
      recoveryRegistrations += 1;
      return () => {};
    },
    connect: async (_onFrame, state) => {
      const frames: TerminalClientMessage[] = [];
      const stream = { frames, disconnect: () => state("disconnected") };
      streams.push(stream);
      return {
        send: async (frame) => {
          const message = decodeTerminalProtocolFrame(frame).message;
          if (!isTerminalClientMessage(message)) throw new Error("Expected a client frame");
          stream.frames.push(message);
          if (message.type === "attach" && streams.length === 2) attached.resolve();
          if (message.type === "attach" && streams.length === 3) reattached.resolve();
        },
        close: () => {},
      };
    },
  };
  const interactive = acquireTerminalTransport(bridge, () => {});
  const output = acquireStartupTerminalOutput(connection, bridge, () => {});
  const stopInteractive = interactive.controller.subscribe("terminal", () => {});
  const stopOutput = output.controller.subscribe("terminal", () => {});
  try {
    await attached.promise;
    await interactive.controller.acknowledge("terminal", 42);
    await output.controller.acknowledge("terminal", 5);
    streams[1]!.disconnect();
    await reattached.promise;
    const startupFrames = [streams[1]!, streams[2]!].flatMap((stream) => stream.frames);
    expect(startupFrames.map((frame) => frame.type)).toEqual(["attach", "ack", "attach"]);
    expect(startupFrames.at(-1)).toMatchObject({ type: "attach", lastConsumedSequence: 5 });
    expect(recoveryRegistrations).toBe(1);
    expect("write" in output.controller).toBe(false);
    expect("resize" in output.controller).toBe(false);
  } finally {
    stopInteractive();
    stopOutput();
    interactive.release();
    output.release();
    await connection.dispose();
  }
});

test("overlapping renderers use separate replay cursors and release their own transports", async () => {
  const connection = createTestClientConnection();
  const attached = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  const streams: TerminalClientMessage[][] = [];
  let closes = 0;
  const bridge: TerminalBridge = {
    connect: async () => {
      const messages: TerminalClientMessage[] = [];
      const index = streams.length;
      streams.push(messages);
      return {
        send: async (frame) => {
          const message = decodeTerminalProtocolFrame(frame).message;
          if (!isTerminalClientMessage(message)) throw new Error("Expected a client frame");
          messages.push(message);
          if (message.type === "attach") attached[index]!.resolve();
        },
        close: () => {
          closes += 1;
        },
      };
    },
  };
  const first = acquireStartupTerminalOutput(connection, bridge, () => {});
  const stopFirst = first.controller.subscribe("terminal", () => {});
  await attached[0]!.promise;
  await first.controller.acknowledge("terminal", 40);
  const second = acquireStartupTerminalOutput(connection, bridge, () => {});
  const stopSecond = second.controller.subscribe("terminal", () => {});
  await attached[1]!.promise;
  expect(second.controller).not.toBe(first.controller);
  expect(streams[1]![0]).toMatchObject({ type: "attach", lastConsumedSequence: null });
  await second.controller.acknowledge("terminal", 5);
  expect(streams[1]!.at(-1)).toMatchObject({ type: "ack", sequenceEnd: 5 });
  stopFirst();
  first.release();
  expect(closes).toBe(1);
  stopSecond();
  await connection.dispose();
  second.release();
  expect(closes).toBe(2);
});

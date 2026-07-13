import { describe, expect, test } from "bun:test";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
} from "@openducktor/contracts";
import type { TerminalBridge } from "@/lib/shell-bridge";
import { createTerminalTransportController } from "./terminal-transport-controller";

const terminalId = "terminal-1";

describe("createTerminalTransportController", () => {
  test("attaches once, preserves consumed sequence on reconnect, and detaches the last listener", async () => {
    const sent: Uint8Array[] = [];
    const closeCalls: number[] = [];
    const bridge: TerminalBridge = {
      connect: async (_onFrame, onStateChange) => {
        onStateChange("connected");
        return {
          send: async (frame) => {
            sent.push(frame);
          },
          close: () => {
            closeCalls.push(1);
          },
        };
      },
    };
    const controller = createTerminalTransportController(bridge, () => {});
    await controller.connect();
    const unsubscribeFirst = controller.subscribe(terminalId, () => {});
    const unsubscribeSecond = controller.subscribe(terminalId, () => {});
    await Promise.resolve();
    const firstFrame = sent[0];
    if (!firstFrame) throw new Error("Expected the initial attach frame.");
    expect(decodeTerminalProtocolFrame(firstFrame).message).toEqual({
      version: TERMINAL_PROTOCOL_VERSION,
      type: "attach",
      terminalId,
      lastConsumedSequence: null,
    });
    expect(sent).toHaveLength(1);

    await controller.acknowledge(terminalId, 41);
    await controller.reconnect();
    const reattachFrame = sent.at(-1);
    if (!reattachFrame) throw new Error("Expected the reconnect attach frame.");
    expect(decodeTerminalProtocolFrame(reattachFrame).message).toEqual({
      version: TERMINAL_PROTOCOL_VERSION,
      type: "attach",
      terminalId,
      lastConsumedSequence: 41,
    });
    expect(closeCalls).toHaveLength(1);

    unsubscribeFirst();
    const retainedFrame = sent.at(-1);
    if (!retainedFrame) throw new Error("Expected a retained attach frame.");
    expect(decodeTerminalProtocolFrame(retainedFrame).message.type).toBe("attach");
    unsubscribeSecond();
    await Promise.resolve();
    const detachFrame = sent.at(-1);
    if (!detachFrame) throw new Error("Expected the detach frame.");
    expect(decodeTerminalProtocolFrame(detachFrame).message.type).toBe("detach");
  });

  test("routes binary output and rejects client-directed frames from the host", async () => {
    let receive = (_frame: Uint8Array): void => {
      throw new Error("Terminal bridge did not connect.");
    };
    const bridge: TerminalBridge = {
      connect: async (onFrame) => {
        receive = onFrame;
        return { send: async () => {}, close: () => {} };
      },
    };
    const controller = createTerminalTransportController(bridge, () => {});
    await controller.connect();
    const emitFrame = receive;
    const outputs: number[][] = [];
    controller.subscribe(terminalId, (_message, payload) => outputs.push([...payload]));
    emitFrame(
      encodeTerminalProtocolFrame({
        message: {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "output",
          terminalId,
          sequenceStart: 0,
          sequenceEnd: 2,
          replay: false,
        },
        payload: new Uint8Array([0, 255]),
      }),
    );
    expect(outputs).toEqual([[0, 255]]);
    expect(() =>
      emitFrame(
        encodeTerminalProtocolFrame({
          message: { version: TERMINAL_PROTOCOL_VERSION, type: "input", terminalId },
          payload: new Uint8Array([1]),
        }),
      ),
    ).toThrow("client-directed");
  });

  test("reattaches from the beginning when the terminal emulator is replaced", async () => {
    const sent: Uint8Array[] = [];
    const bridge: TerminalBridge = {
      connect: async () => ({
        send: async (frame) => {
          sent.push(frame);
        },
        close: () => {},
      }),
    };
    const controller = createTerminalTransportController(bridge, () => {});
    await controller.connect();
    const unsubscribe = controller.subscribe(terminalId, () => {});
    await Promise.resolve();
    await controller.acknowledge(terminalId, 41);

    controller.releaseEmulator(terminalId);
    unsubscribe();
    controller.subscribe(terminalId, () => {});
    await Promise.resolve();

    const attachFrames = sent
      .map((frame) => decodeTerminalProtocolFrame(frame).message)
      .filter((message) => message.type === "attach");
    expect(attachFrames.at(-1)).toEqual({
      version: TERMINAL_PROTOCOL_VERSION,
      type: "attach",
      terminalId,
      lastConsumedSequence: null,
    });
  });
});

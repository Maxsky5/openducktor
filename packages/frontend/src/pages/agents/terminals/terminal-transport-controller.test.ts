import { describe, expect, test } from "bun:test";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
} from "@openducktor/contracts";
import type { TerminalBridge, TerminalTransportConnection } from "@/lib/shell-bridge";
import { createTerminalTransportController } from "./terminal-transport-controller";

const terminalId = "terminal-1";

describe("createTerminalTransportController", () => {
  test("waits for an in-flight connection before sending the initial resize", async () => {
    const sent: Uint8Array[] = [];
    let resolveConnection = (_connection: TerminalTransportConnection): void => {
      throw new Error("Terminal bridge connection was not requested.");
    };
    const bridge: TerminalBridge = {
      connect: () =>
        new Promise((resolve) => {
          resolveConnection = resolve;
        }),
    };
    const controller = createTerminalTransportController(bridge, () => {});

    const connecting = controller.connect();
    const resizing = controller.resize(terminalId, 120, 40);
    await Promise.resolve();
    expect(sent).toHaveLength(0);

    resolveConnection({
      send: async (frame) => {
        sent.push(frame);
      },
      close: () => {},
    });
    await Promise.all([connecting, resizing]);

    const resizeFrame = sent[0];
    if (!resizeFrame) throw new Error("Expected the initial resize frame.");
    expect(decodeTerminalProtocolFrame(resizeFrame).message).toEqual({
      version: TERMINAL_PROTOCOL_VERSION,
      type: "resize",
      terminalId,
      columns: 120,
      rows: 40,
    });
  });

  test("waits for attach before sending resize or input", async () => {
    let releaseAttach = (): void => {
      throw new Error("The attach frame was not sent.");
    };
    const attachBlocked = new Promise<void>((resolve) => {
      releaseAttach = resolve;
    });
    const operations: string[] = [];
    const bridge: TerminalBridge = {
      connect: async () => ({
        send: async (frame) => {
          const message = decodeTerminalProtocolFrame(frame).message;
          operations.push(message.type);
          if (message.type === "attach") await attachBlocked;
        },
        close: () => {},
      }),
    };
    const controller = createTerminalTransportController(bridge, () => {});
    await controller.connect();

    controller.subscribe(terminalId, () => {});
    const resizing = controller.resize(terminalId, 120, 40);
    const writing = controller.write(terminalId, new Uint8Array([1]));
    await Promise.resolve();
    expect(operations).toEqual(["attach"]);

    releaseAttach();
    await Promise.all([resizing, writing]);
    expect(operations).toEqual(["attach", "resize", "input"]);
  });

  test("attaches once, preserves consumed sequence when replacing the transport, and detaches the last listener", async () => {
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
    await controller.connect();
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

  test("automatically reconnects and reattaches after transport loss", async () => {
    const sentByConnection: Uint8Array[][] = [];
    const stateListeners: Array<(state: "connected" | "disconnected") => void> = [];
    const observedStates: Array<"connected" | "disconnected"> = [];
    const bridge: TerminalBridge = {
      connect: async (_onFrame, onStateChange) => {
        const sent: Uint8Array[] = [];
        sentByConnection.push(sent);
        stateListeners.push(onStateChange);
        onStateChange("connected");
        return {
          send: async (frame) => {
            sent.push(frame);
          },
          close: () => undefined,
        };
      },
    };
    const controller = createTerminalTransportController(bridge, (state) => {
      observedStates.push(state);
    });
    await controller.connect();
    controller.subscribe(terminalId, () => undefined);
    await Promise.resolve();
    await controller.acknowledge(terminalId, 41);

    stateListeners[0]?.("disconnected");
    await Bun.sleep(10);

    expect(sentByConnection).toHaveLength(2);
    const reattachFrame = sentByConnection[1]?.[0];
    if (!reattachFrame) throw new Error("Expected an automatic reattach frame.");
    expect(decodeTerminalProtocolFrame(reattachFrame).message).toEqual({
      version: TERMINAL_PROTOCOL_VERSION,
      type: "attach",
      terminalId,
      lastConsumedSequence: 41,
    });
    expect(observedStates).toEqual(["connected", "disconnected", "connected"]);
    controller.dispose();
  });

  test("reconnects when the initial attachment send fails", async () => {
    const sentByConnection: string[][] = [];
    let connectionCount = 0;
    const bridge: TerminalBridge = {
      connect: async () => {
        connectionCount += 1;
        const sent: string[] = [];
        sentByConnection.push(sent);
        return {
          send: async (frame) => {
            const type = decodeTerminalProtocolFrame(frame).message.type;
            if (connectionCount === 1 && type === "attach") throw new Error("socket closed");
            sent.push(type);
          },
          close: () => undefined,
        };
      },
    };
    const controller = createTerminalTransportController(bridge, () => undefined);
    controller.subscribe(terminalId, () => undefined);

    await expect(controller.connect()).rejects.toThrow("socket closed");
    await Bun.sleep(10);

    expect(connectionCount).toBe(2);
    expect(sentByConnection[1]).toEqual(["attach"]);
    await controller.dispose();
  });

  test("invalidates and replaces a connection when an established send rejects", async () => {
    const states: string[] = [];
    const failures: string[] = [];
    let connectionCount = 0;
    const bridge: TerminalBridge = {
      connect: async () => {
        connectionCount += 1;
        const attempt = connectionCount;
        return {
          send: async () => {
            if (attempt === 1) throw new Error("socket send failed");
          },
          close: () => undefined,
        };
      },
    };
    const controller = createTerminalTransportController(
      bridge,
      (state) => states.push(state),
      (failure) => failures.push(failure.message),
    );
    await controller.connect();

    await expect(controller.write(terminalId, new Uint8Array([1]))).rejects.toThrow(
      "socket send failed",
    );
    await Bun.sleep(10);

    expect(connectionCount).toBe(2);
    expect(states).toContain("disconnected");
    expect(failures).toEqual(["socket send failed"]);
    await expect(controller.write(terminalId, new Uint8Array([2]))).resolves.toBeUndefined();
    await controller.dispose();
  });

  test("backs off when attachment sends fail repeatedly", async () => {
    let connectionCount = 0;
    const bridge: TerminalBridge = {
      connect: async () => {
        connectionCount += 1;
        const attempt = connectionCount;
        return {
          send: async (frame) => {
            const type = decodeTerminalProtocolFrame(frame).message.type;
            if (attempt < 3 && type === "attach") throw new Error("socket closed");
          },
          close: () => undefined,
        };
      },
    };
    const controller = createTerminalTransportController(bridge, () => undefined);
    controller.subscribe(terminalId, () => undefined);

    await expect(controller.connect()).rejects.toThrow("socket closed");
    await Bun.sleep(20);
    expect(connectionCount).toBe(2);

    await Bun.sleep(260);
    expect(connectionCount).toBe(3);
    await controller.dispose();
  });

  test("reconnects when closing the failed connection also fails", async () => {
    const failures: string[] = [];
    let connectionCount = 0;
    const bridge: TerminalBridge = {
      connect: async () => {
        connectionCount += 1;
        const attempt = connectionCount;
        return {
          send: async (frame) => {
            const type = decodeTerminalProtocolFrame(frame).message.type;
            if (attempt === 1 && type === "attach") throw new Error("socket closed");
          },
          close: async () => {
            if (attempt === 1) throw new Error("close failed");
          },
        };
      },
    };
    const controller = createTerminalTransportController(
      bridge,
      () => undefined,
      (failure) => failures.push(failure.message),
    );
    controller.subscribe(terminalId, () => undefined);

    await expect(controller.connect()).rejects.toThrow("socket closed");
    await Bun.sleep(10);

    expect(connectionCount).toBe(2);
    expect(failures).toEqual(["socket closed", "close failed"]);
    await controller.dispose();
  });

  test("does not restore a pending connection after it reports disconnection", async () => {
    let resolveFirst = (_connection: TerminalTransportConnection): void => undefined;
    let disconnectFirst = (): void => undefined;
    const staleClosed: number[] = [];
    const activeSent: string[] = [];
    let connectionCount = 0;
    const bridge: TerminalBridge = {
      connect: (_onFrame, onStateChange) => {
        connectionCount += 1;
        if (connectionCount === 1) {
          disconnectFirst = () => onStateChange("disconnected");
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({
          send: async (frame) => {
            activeSent.push(decodeTerminalProtocolFrame(frame).message.type);
          },
          close: () => undefined,
        });
      },
    };
    const controller = createTerminalTransportController(bridge, () => undefined);
    const connecting = controller.connect();

    await Promise.resolve();
    disconnectFirst();
    resolveFirst({
      send: async () => undefined,
      close: () => {
        staleClosed.push(1);
      },
    });
    await connecting;
    await Bun.sleep(10);
    await controller.write(terminalId, new Uint8Array([1]));

    expect(staleClosed).toHaveLength(1);
    expect(connectionCount).toBe(2);
    expect(activeSent).toEqual(["input"]);
    await controller.dispose();
  });

  test("does not lose a synchronous disconnection reported while connecting", async () => {
    const staleClosed: number[] = [];
    const activeSent: string[] = [];
    let connectionCount = 0;
    const bridge: TerminalBridge = {
      connect: async (_onFrame, onStateChange) => {
        connectionCount += 1;
        if (connectionCount === 1) {
          onStateChange("disconnected");
          return {
            send: async () => undefined,
            close: () => {
              staleClosed.push(1);
            },
          };
        }
        return {
          send: async (frame) => {
            activeSent.push(decodeTerminalProtocolFrame(frame).message.type);
          },
          close: () => undefined,
        };
      },
    };
    const controller = createTerminalTransportController(bridge, () => undefined);

    await controller.connect();
    await Bun.sleep(10);
    await controller.write(terminalId, new Uint8Array([1]));

    expect(staleClosed).toHaveLength(1);
    expect(connectionCount).toBe(2);
    expect(activeSent).toEqual(["input"]);
    await controller.dispose();
  });

  test("serializes ACK sends so an earlier consumed sequence cannot arrive after a later one", async () => {
    let releaseFirstAck = (): void => {
      throw new Error("The first ACK was not sent.");
    };
    const firstAckBlocked = new Promise<void>((resolve) => {
      releaseFirstAck = resolve;
    });
    const processedSequences: number[] = [];
    let acknowledgedSequence = 0;
    const bridge: TerminalBridge = {
      connect: async () => ({
        send: async (frame) => {
          const message = decodeTerminalProtocolFrame(frame).message;
          if (message.type !== "ack") return;
          if (message.sequenceEnd === 1) await firstAckBlocked;
          if (message.sequenceEnd < acknowledgedSequence) {
            throw new Error("Terminal ACK is outside the delivered sequence range.");
          }
          acknowledgedSequence = message.sequenceEnd;
          processedSequences.push(message.sequenceEnd);
        },
        close: () => {},
      }),
    };
    const controller = createTerminalTransportController(bridge, () => {});
    await controller.connect();

    const first = controller.acknowledge(terminalId, 1);
    const second = controller.acknowledge(terminalId, 2);
    await Promise.resolve();
    releaseFirstAck();
    await Promise.all([first, second]);

    expect(processedSequences).toEqual([1, 2]);
  });

  test("does not send ACKs for replay sequences that were already consumed", async () => {
    const processedSequences: number[] = [];
    let acknowledgedSequence = 0;
    const bridge: TerminalBridge = {
      connect: async () => ({
        send: async (frame) => {
          const message = decodeTerminalProtocolFrame(frame).message;
          if (message.type !== "ack") return;
          if (message.sequenceEnd < acknowledgedSequence) {
            throw new Error("Terminal ACK is outside the delivered sequence range.");
          }
          acknowledgedSequence = message.sequenceEnd;
          processedSequences.push(message.sequenceEnd);
        },
        close: () => {},
      }),
    };
    const controller = createTerminalTransportController(bridge, () => {});
    await controller.connect();

    for (const sequenceEnd of [179, 285, 388, 812, 827]) {
      await controller.acknowledge(terminalId, sequenceEnd);
    }
    for (const sequenceEnd of [179, 285, 388, 812, 827]) {
      await controller.acknowledge(terminalId, sequenceEnd);
    }

    expect(processedSequences).toEqual([179, 285, 388, 812, 827]);
  });

  test("keeps detach and reattach behind an in-flight ACK for the same terminal", async () => {
    let releaseAck = (): void => {
      throw new Error("The ACK was not sent.");
    };
    const ackBlocked = new Promise<void>((resolve) => {
      releaseAck = resolve;
    });
    let attachCount = 0;
    let attachment: { acknowledged: number; delivered: number } | null = null;
    const operations: string[] = [];
    const bridge: TerminalBridge = {
      connect: async () => ({
        send: async (frame) => {
          const message = decodeTerminalProtocolFrame(frame).message;
          if (message.type === "attach") {
            operations.push("attach");
            attachCount += 1;
            attachment = { acknowledged: 0, delivered: attachCount === 1 ? 1 : 0 };
            return;
          }
          if (message.type === "detach") {
            operations.push("detach");
            attachment = null;
            return;
          }
          if (message.type !== "ack") return;
          operations.push("ack:start");
          await ackBlocked;
          if (
            !attachment ||
            message.sequenceEnd < attachment.acknowledged ||
            message.sequenceEnd > attachment.delivered
          ) {
            throw new Error("Terminal ACK is outside the delivered sequence range.");
          }
          attachment.acknowledged = message.sequenceEnd;
          operations.push("ack:complete");
        },
        close: () => {},
      }),
    };
    const controller = createTerminalTransportController(bridge, () => {});
    await controller.connect();
    const unsubscribe = controller.subscribe(terminalId, () => {});
    await Promise.resolve();
    await Promise.resolve();

    const acknowledging = controller.acknowledge(terminalId, 1);
    await Promise.resolve();
    controller.releaseEmulator(terminalId);
    unsubscribe();
    controller.subscribe(terminalId, () => {});
    await Promise.resolve();
    await Promise.resolve();
    releaseAck();

    await expect(acknowledging).resolves.toBeUndefined();
    await Promise.resolve();
    expect(operations).toEqual(["attach", "ack:start", "ack:complete", "detach", "attach"]);
  });

  test("preempts pending attachment work and skips detach when the host terminal is closing", async () => {
    let releaseAck = (): void => {
      throw new Error("The ACK was not sent.");
    };
    const ackBlocked = new Promise<void>((resolve) => {
      releaseAck = resolve;
    });
    let markAckStarted = (): void => {
      throw new Error("The ACK start signal was not initialized.");
    };
    const ackStarted = new Promise<void>((resolve) => {
      markAckStarted = resolve;
    });
    const operations: string[] = [];
    const bridge: TerminalBridge = {
      connect: async () => ({
        send: async (frame) => {
          const message = decodeTerminalProtocolFrame(frame).message;
          if (message.type === "ack") {
            operations.push("ack:start");
            markAckStarted();
            await ackBlocked;
            operations.push("ack:complete");
            return;
          }
          operations.push(message.type);
        },
        close: () => {},
      }),
    };
    const controller = createTerminalTransportController(bridge, () => {});
    await controller.connect();
    const unsubscribe = controller.subscribe(terminalId, () => {});
    await Promise.resolve();

    const acknowledging = controller.acknowledge(terminalId, 1);
    await ackStarted;
    const resizing = controller.resize(terminalId, 120, 40);
    const writing = controller.write(terminalId, new Uint8Array([1]));
    const closing = controller.closeTerminal(terminalId, async () => {
      operations.push("close");
      return { closed: true };
    });
    await Promise.resolve();
    expect(operations).toEqual(["attach", "ack:start", "close"]);

    unsubscribe();
    await Promise.resolve();
    expect(operations).toEqual(["attach", "ack:start", "close"]);

    releaseAck();
    await Promise.all([acknowledging, resizing, writing, closing]);

    expect(operations).toEqual(["attach", "ack:start", "close", "ack:complete"]);
  });

  test("keeps queued attachment work when close requires confirmation", async () => {
    let releaseAck = (): void => {
      throw new Error("The ACK was not sent.");
    };
    const ackBlocked = new Promise<void>((resolve) => {
      releaseAck = resolve;
    });
    let markAckStarted = (): void => {
      throw new Error("The ACK start signal was not initialized.");
    };
    const ackStarted = new Promise<void>((resolve) => {
      markAckStarted = resolve;
    });
    const operations: string[] = [];
    const bridge: TerminalBridge = {
      connect: async () => ({
        send: async (frame) => {
          const message = decodeTerminalProtocolFrame(frame).message;
          if (message.type === "ack") {
            operations.push("ack:start");
            markAckStarted();
            await ackBlocked;
            operations.push("ack:complete");
            return;
          }
          operations.push(message.type);
        },
        close: () => {},
      }),
    };
    const controller = createTerminalTransportController(bridge, () => {});
    await controller.connect();
    const unsubscribe = controller.subscribe(terminalId, () => {});
    await Promise.resolve();

    const acknowledging = controller.acknowledge(terminalId, 1);
    await ackStarted;
    const resizing = controller.resize(terminalId, 120, 40);
    const writing = controller.write(terminalId, new Uint8Array([1]));
    const closing = controller.closeTerminal(terminalId, async () => {
      operations.push("close");
      return { closed: false };
    });
    await expect(closing).resolves.toEqual({ closed: false });
    expect(operations).toEqual(["attach", "ack:start", "close"]);

    releaseAck();
    await Promise.all([acknowledging, resizing, writing]);
    unsubscribe();
    await Promise.resolve();

    expect(operations).toEqual([
      "attach",
      "ack:start",
      "close",
      "ack:complete",
      "resize",
      "input",
      "detach",
    ]);
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

  test("reports connection-global protocol errors instead of dropping them", async () => {
    let receive = (_frame: Uint8Array): void => {
      throw new Error("Terminal bridge did not connect.");
    };
    const states: string[] = [];
    const failures: string[] = [];
    const bridge: TerminalBridge = {
      connect: async (onFrame) => {
        receive = onFrame;
        return { send: async () => {}, close: () => {} };
      },
    };
    const controller = createTerminalTransportController(
      bridge,
      (state) => states.push(state),
      (failure) => failures.push(failure.message),
    );
    await controller.connect();

    receive(
      encodeTerminalProtocolFrame({
        message: {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "protocol_error",
          failure: { code: "protocol_error", message: "Connection protocol failed." },
        },
        payload: new Uint8Array(),
      }),
    );

    expect(failures).toEqual(["Connection protocol failed."]);
    expect(states).toContain("disconnected");
  });

  test("delivers a terminal-scoped stale attach failure to its subscriber", async () => {
    let receive = (_frame: Uint8Array): void => {
      throw new Error("Terminal bridge did not connect.");
    };
    const bridge: TerminalBridge = {
      connect: async (onFrame) => {
        receive = onFrame;
        return {
          send: async (frame) => {
            const message = decodeTerminalProtocolFrame(frame).message;
            if (message.type !== "attach") return;
            receive(
              encodeTerminalProtocolFrame({
                message: {
                  version: TERMINAL_PROTOCOL_VERSION,
                  type: "protocol_error",
                  terminalId: message.terminalId,
                  failure: {
                    code: "terminal_forgotten",
                    message: "Terminal ended when the host restarted.",
                    terminalId: message.terminalId,
                  },
                },
                payload: new Uint8Array(),
              }),
            );
          },
          close: () => {},
        };
      },
    };
    const controller = createTerminalTransportController(bridge, () => {});
    const failures: string[] = [];
    await controller.connect();

    controller.subscribe(terminalId, (message) => {
      if (message.type === "protocol_error") failures.push(message.failure.code);
    });
    await Promise.resolve();

    expect(failures).toEqual(["terminal_forgotten"]);
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

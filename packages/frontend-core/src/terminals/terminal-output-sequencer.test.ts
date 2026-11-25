import { describe, expect, mock, test } from "bun:test";
import {
  TERMINAL_PROTOCOL_VERSION,
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  type TerminalServerMessage,
} from "@openducktor/contracts";
import { createTerminalOutputSequencer } from "./terminal-output-sequencer";
import { createTerminalTransportController } from "./terminal-transport-controller";

/** An xterm stand-in that parses its queued writes when the test calls `parse`. */
const createParser = () => {
  let queued: Array<() => void> = [];
  return {
    write: (_payload: Uint8Array, parsed: () => void): void => {
      queued.push(parsed);
    },
    parse: (): void => {
      const callbacks = queued;
      queued = [];
      for (const parsed of callbacks) parsed();
    },
  };
};

const outputFrame = (sequenceStart: number, sequenceEnd: number) =>
  ({ sequenceStart, sequenceEnd }) as const;

describe("createTerminalOutputSequencer", () => {
  test("acknowledges replayed bytes that xterm parsed during an earlier attachment", async () => {
    const parser = createParser();
    const acks: number[] = [];
    const sequencer = createTerminalOutputSequencer({
      write: parser.write,
      onConsumed: (sequence) => acks.push(sequence),
    });
    const written = sequencer.enqueue(outputFrame(0, 10), new Uint8Array(10));
    // The terminal hides before xterm parses the bytes, so they send no ACK.
    sequencer.detach();
    parser.parse();
    await written;
    expect(acks).toEqual([]);

    // The next attachment replays from the last ACK. xterm has these bytes already.
    await sequencer.enqueue(outputFrame(0, 10), new Uint8Array(10));

    expect(acks).toEqual([10]);
  });

  test("reports a canceled restore and keeps the parsed position for replay", async () => {
    const parser = createParser();
    const written: number[] = [];
    const completed: boolean[] = [];
    const resetScreen = mock(() => undefined);
    const sequencer = createTerminalOutputSequencer({
      write: (payload, parsed) => {
        written.push(payload.byteLength);
        parser.write(payload, parsed);
      },
      onConsumed: () => undefined,
    });
    void sequencer.enqueue(outputFrame(0, 10), new Uint8Array(10));
    const restored = sequencer.restore(40, new Uint8Array(4), resetScreen, (value) =>
      completed.push(value),
    );
    sequencer.detach();
    parser.parse();
    await restored;

    // The next attachment replays from the last ACK. xterm never got the restore.
    const replayed = sequencer.enqueue(outputFrame(10, 20), new Uint8Array(10));
    parser.parse();
    await replayed;

    expect(resetScreen).not.toHaveBeenCalled();
    expect(completed).toEqual([false]);
    expect(written).toEqual([10, 10]);
  });

  test("sends the ACK of a hidden first screen before the detach frame", async () => {
    const terminalId = "terminal-1";
    const sent: string[] = [];
    const detached = Promise.withResolvers<void>();
    let receive: (frame: Uint8Array) => void = () => undefined;
    const controller = createTerminalTransportController(
      {
        connect: async (onFrame, onStateChange) => {
          receive = onFrame;
          onStateChange("connected");
          return {
            send: async (frame) => {
              const { message } = decodeTerminalProtocolFrame(frame);
              sent.push(message.type === "ack" ? `ack:${message.sequenceEnd}` : message.type);
              if (message.type === "detach") detached.resolve();
            },
            close: () => undefined,
          };
        },
      },
      () => undefined,
    );
    await controller.connect();
    const parser = createParser();
    let unsubscribe: (() => void) | null = null;
    const sequencer = createTerminalOutputSequencer({
      write: parser.write,
      onConsumed: (sequence) => void controller.acknowledge(terminalId, sequence),
      onHydrated: () => {
        sequencer.detach();
        unsubscribe?.();
      },
    });
    unsubscribe = controller.subscribe(terminalId, (message: TerminalServerMessage, payload) => {
      if (message.type === "snapshot") sequencer.setSnapshotBoundary(message.snapshotSequenceEnd);
      if (message.type === "output") void sequencer.enqueue(message, payload);
    });
    const deliver = (message: TerminalServerMessage, payload = new Uint8Array()) =>
      receive(encodeTerminalProtocolFrame({ message, payload }));
    deliver({
      version: TERMINAL_PROTOCOL_VERSION,
      type: "snapshot",
      terminalId,
      earliestRetainedSequence: 0,
      snapshotSequenceEnd: 4,
      lifecycle: "running",
      title: "Shell",
      complete: true,
    });
    deliver(
      {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "output",
        terminalId,
        sequenceStart: 0,
        sequenceEnd: 4,
        replay: true,
      },
      new TextEncoder().encode("ok\r\n"),
    );
    parser.parse();
    await detached.promise;

    expect(sent).toEqual(["attach", "ack:4", "detach"]);
    await controller.dispose();
  });
});

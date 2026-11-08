import { describe, expect, test } from "bun:test";
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
  test("sends the ACK of parsed output when the terminal detaches as it hydrates", async () => {
    const parser = createParser();
    const acks: number[] = [];
    let sequencer: ReturnType<typeof createTerminalOutputSequencer> | null = null;
    sequencer = createTerminalOutputSequencer({
      write: parser.write,
      onConsumed: (sequence) => acks.push(sequence),
      // A hidden viewport detaches when its first screen is parsed.
      onHydrated: () => sequencer?.detach(),
    });
    sequencer.setSnapshotBoundary(5);
    const written = sequencer.enqueue(outputFrame(0, 5), new Uint8Array(5));
    parser.parse();
    await written;
    await Bun.sleep(0);

    expect(acks).toEqual([5]);
  });

  test("acknowledges replayed bytes that xterm parsed during an earlier attachment", async () => {
    const parser = createParser();
    const acks: number[] = [];
    const sequencer = createTerminalOutputSequencer({
      write: parser.write,
      onConsumed: (sequence) => acks.push(sequence),
    });
    void sequencer.enqueue(outputFrame(0, 10), new Uint8Array(10));
    // The terminal hides before xterm parses the bytes, so they send no ACK.
    sequencer.detach();
    parser.parse();
    await Bun.sleep(0);
    expect(acks).toEqual([]);

    // The next attachment replays from the last ACK. xterm has these bytes already.
    await sequencer.enqueue(outputFrame(0, 10), new Uint8Array(10));
    await Bun.sleep(0);

    expect(acks).toEqual([10]);
  });

  test("finishes a waiting restore that a detach replaces", async () => {
    const parser = createParser();
    const finished: boolean[] = [];
    const prepared: string[] = [];
    const sequencer = createTerminalOutputSequencer({
      write: parser.write,
      onConsumed: () => undefined,
    });
    void sequencer.enqueue(outputFrame(0, 10), new Uint8Array(10));
    // The restore waits until xterm parses the earlier output.
    const restored = sequencer.restore(
      40,
      new Uint8Array(4),
      () => prepared.push("reset"),
      (completed) => finished.push(completed),
    );
    sequencer.detach();
    parser.parse();
    await restored;

    expect(prepared).toEqual([]);
    expect(finished).toEqual([false]);
  });

  test("sends the ACK of a hidden first screen before the detach frame", async () => {
    const terminalId = "terminal-1";
    const sent: string[] = [];
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
    await Bun.sleep(0);
    parser.parse();
    await Bun.sleep(10);

    expect(sent).toEqual(["attach", "ack:4", "detach"]);
    await controller.dispose();
  });
});

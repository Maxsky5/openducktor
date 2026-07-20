import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalServerMessage,
  type TerminalSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TerminalPtyError, TerminalPtyHandle } from "../../ports/terminal-pty-port";
import { TERMINAL_LIMITS } from "./terminal-limits";

const OUTPUT_CHUNK_BYTES = 64 * 1024;
const EMPTY_PAYLOAD = new Uint8Array(0);

type ReplayChunk = {
  sequenceStart: number;
  sequenceEnd: number;
  data: Uint8Array;
};

type TerminalAttachment = {
  attachmentId: string;
  sink: (event: TerminalServerMessage, payload: Uint8Array) => void;
  acknowledgedSequence: number;
  deliveredSequence: number;
  pendingBytes: number;
};

export type TerminalSessionAttachInput = {
  terminalId: string;
  attachmentId: string;
  lastConsumedSequence: number | null;
  sink: TerminalAttachment["sink"];
};

export type TerminalOutputEvent =
  | { type: "attachments_empty" }
  | { type: "incomplete_replay" }
  | { type: "overflow" }
  | { type: "pause_requested" };

export type TerminalOutputEvents = TerminalOutputEvent[];

export class TerminalOutputStateError extends Error {
  constructor(
    readonly code: "attachment_not_found" | "invalid_ack" | "invalid_replay_position",
    message: string,
  ) {
    super(message);
    this.name = "TerminalOutputStateError";
  }
}

const event = (type: TerminalOutputEvent["type"]): TerminalOutputEvents => [{ type }];

const mergeEvents = (
  left: TerminalOutputEvents,
  right: TerminalOutputEvents,
): TerminalOutputEvents => {
  const existing = new Set(left.map((candidate) => candidate.type));
  return [...left, ...right.filter((candidate) => !existing.has(candidate.type))];
};

export class TerminalSessionOutput {
  private readonly replay: ReplayChunk[] = [];
  private replayBytes = 0;
  private sequence = 0;
  private readonly attachments = new Map<string, TerminalAttachment>();
  private paused = false;
  private overflowed = false;

  constructor(
    private readonly terminalId: string,
    private readonly replayByteLimit: number,
  ) {}

  get nextSequence(): number {
    return this.sequence;
  }

  get earliestRetainedSequence(): number {
    return this.replay[0]?.sequenceStart ?? this.sequence;
  }

  attach(
    input: TerminalSessionAttachInput,
    summary: TerminalSummary,
    handle: TerminalPtyHandle | null,
  ): TerminalOutputEvents {
    const requested = input.lastConsumedSequence ?? 0;
    if (requested > this.sequence) {
      throw new TerminalOutputStateError(
        "invalid_replay_position",
        `Terminal replay position ${requested} is beyond the published sequence ${this.sequence}.`,
      );
    }
    const attachment: TerminalAttachment = {
      attachmentId: input.attachmentId,
      sink: input.sink,
      acknowledgedSequence: requested,
      deliveredSequence: requested,
      pendingBytes: 0,
    };
    const previous = this.attachments.get(input.attachmentId);
    this.attachments.set(input.attachmentId, attachment);
    try {
      this.publishTo(attachment, {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "snapshot",
        terminalId: this.terminalId,
        earliestRetainedSequence: this.earliestRetainedSequence,
        snapshotSequenceEnd: this.sequence,
        lifecycle: summary.lifecycle,
        title: summary.label,
        complete: requested >= this.earliestRetainedSequence,
      });
      return this.flush(attachment, true, handle);
    } catch (cause) {
      if (previous) this.attachments.set(input.attachmentId, previous);
      else this.attachments.delete(input.attachmentId);
      throw cause;
    }
  }

  publish(message: TerminalServerMessage): TerminalOutputEvents {
    let events: TerminalOutputEvents = [];
    for (const attachment of [...this.attachments.values()]) {
      events = mergeEvents(events, this.tryPublish(attachment, message).events);
    }
    return events;
  }

  accept(data: Uint8Array, handle: TerminalPtyHandle | null): TerminalOutputEvents {
    let events: TerminalOutputEvents = [];
    if (data.byteLength === 0 || this.overflowed) return events;
    for (let offset = 0; offset < data.byteLength; offset += OUTPUT_CHUNK_BYTES) {
      const bytes = data.slice(offset, Math.min(data.byteLength, offset + OUTPUT_CHUNK_BYTES));
      const chunk = this.append(bytes);
      for (const attachment of [...this.attachments.values()]) {
        const delivered = this.deliver(attachment, chunk, false, handle);
        events = mergeEvents(events, delivered.events);
      }
      if (events.some((candidate) => candidate.type === "overflow")) return events;
    }
    return events;
  }

  acknowledge(attachmentId: string, sequenceEnd: number): void {
    const attachment = this.attachments.get(attachmentId);
    if (!attachment) {
      throw new TerminalOutputStateError(
        "attachment_not_found",
        `Terminal attachment not found: ${attachmentId}`,
      );
    }
    if (
      !Number.isInteger(sequenceEnd) ||
      sequenceEnd < attachment.acknowledgedSequence ||
      sequenceEnd > attachment.deliveredSequence
    ) {
      throw new TerminalOutputStateError(
        "invalid_ack",
        "Terminal ACK is outside the delivered sequence range.",
      );
    }
    attachment.acknowledgedSequence = sequenceEnd;
    attachment.pendingBytes = attachment.deliveredSequence - sequenceEnd;
  }

  detach(attachmentId: string): void {
    this.attachments.delete(attachmentId);
  }

  resumeIfUnblocked(
    handle: TerminalPtyHandle | null,
  ): Effect.Effect<TerminalOutputEvents, TerminalPtyError> {
    if (
      !this.paused ||
      ![...this.attachments.values()].every(
        (candidate) => candidate.pendingBytes <= TERMINAL_LIMITS.resumeOutputBytes,
      )
    ) {
      return Effect.succeed([]);
    }
    if (!handle) return Effect.succeed([]);
    return Effect.gen(this, function* () {
      yield* handle.resumeOutput();
      this.paused = false;
      let events: TerminalOutputEvents = [];
      for (const attachment of [...this.attachments.values()]) {
        events = mergeEvents(events, this.flush(attachment, false, handle));
      }
      return events;
    });
  }

  markOverflowed(): boolean {
    if (this.overflowed) return false;
    this.overflowed = true;
    return true;
  }

  private append(data: Uint8Array): ReplayChunk {
    const chunk = {
      sequenceStart: this.sequence,
      sequenceEnd: this.sequence + data.byteLength,
      data,
    };
    this.sequence = chunk.sequenceEnd;
    this.replay.push(chunk);
    this.replayBytes += data.byteLength;
    while (this.replayBytes > this.replayByteLimit) {
      const removed = this.replay.shift();
      if (!removed) break;
      this.replayBytes -= removed.data.byteLength;
    }
    return chunk;
  }

  private publishTo(
    attachment: TerminalAttachment,
    message: TerminalServerMessage,
    payload: Uint8Array = EMPTY_PAYLOAD,
  ): void {
    attachment.sink(message, payload);
  }

  private tryPublish(
    attachment: TerminalAttachment,
    message: TerminalServerMessage,
    payload: Uint8Array = EMPTY_PAYLOAD,
  ): { delivered: boolean; events: TerminalOutputEvents } {
    try {
      this.publishTo(attachment, message, payload);
      return { delivered: true, events: [] };
    } catch {
      this.attachments.delete(attachment.attachmentId);
      return {
        delivered: false,
        events: this.attachments.size === 0 ? event("attachments_empty") : [],
      };
    }
  }

  private requestPause(handle: TerminalPtyHandle | null): TerminalOutputEvents {
    if (this.paused || !handle) return [];
    if (!handle.supportsOutputPause) return event("overflow");
    this.paused = true;
    return event("pause_requested");
  }

  private deliver(
    attachment: TerminalAttachment,
    chunk: ReplayChunk,
    replay: boolean,
    handle: TerminalPtyHandle | null,
  ): { delivered: boolean; events: TerminalOutputEvents } {
    if (chunk.sequenceEnd <= attachment.deliveredSequence) {
      return { delivered: true, events: [] };
    }
    const start = Math.max(chunk.sequenceStart, attachment.deliveredSequence);
    const payload = chunk.data.subarray(start - chunk.sequenceStart);
    if (attachment.pendingBytes + payload.byteLength > TERMINAL_LIMITS.pendingOutputBytes) {
      return { delivered: false, events: this.requestPause(handle) };
    }
    const published = this.tryPublish(
      attachment,
      {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "output",
        terminalId: this.terminalId,
        sequenceStart: start,
        sequenceEnd: chunk.sequenceEnd,
        replay,
      },
      payload,
    );
    if (!published.delivered) return published;
    attachment.deliveredSequence = chunk.sequenceEnd;
    attachment.pendingBytes = attachment.deliveredSequence - attachment.acknowledgedSequence;
    const pressure =
      attachment.pendingBytes >= TERMINAL_LIMITS.pendingOutputBytes
        ? this.requestPause(handle)
        : [];
    return { delivered: true, events: mergeEvents(published.events, pressure) };
  }

  private flush(
    attachment: TerminalAttachment,
    replay: boolean,
    handle: TerminalPtyHandle | null = null,
  ): TerminalOutputEvents {
    let events: TerminalOutputEvents = [];
    const earliest = this.earliestRetainedSequence;
    if (attachment.deliveredSequence < earliest) {
      const published = this.tryPublish(attachment, {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "replay_gap",
        terminalId: this.terminalId,
        missingSequenceStart: attachment.deliveredSequence,
        missingSequenceEnd: earliest,
      });
      events = mergeEvents(events, published.events);
      if (!published.delivered) return events;
      attachment.deliveredSequence = earliest;
      attachment.acknowledgedSequence = earliest;
      attachment.pendingBytes = 0;
      events = mergeEvents(events, event("incomplete_replay"));
    }
    for (const chunk of this.replay) {
      const delivered = this.deliver(attachment, chunk, replay, handle);
      events = mergeEvents(events, delivered.events);
      if (!delivered.delivered) break;
    }
    return events;
  }
}

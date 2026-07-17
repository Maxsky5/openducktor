import { TERMINAL_PROTOCOL_VERSION, type TerminalServerMessage } from "@openducktor/contracts";
import { Effect } from "effect";
import { TERMINAL_LIMITS } from "./terminal-limits";
import type { ReplayChunk, TerminalAttachment, TerminalSession } from "./terminal-session";

const OUTPUT_CHUNK_BYTES = 64 * 1024;
const EMPTY_PAYLOAD = new Uint8Array(0);

export type TerminalSessionAttachInput = {
  terminalId: string;
  attachmentId: string;
  lastConsumedSequence: number | null;
  sink: TerminalAttachment["sink"];
};

export type TerminalStreamEvent =
  | { type: "attachments_empty" }
  | { type: "incomplete_replay" }
  | { type: "overflow" }
  | { type: "pause_requested" };

export type TerminalStreamEvents = TerminalStreamEvent[];

const streamEvent = (type: TerminalStreamEvent["type"]): TerminalStreamEvents => [{ type }];

const mergeStreamEvents = (
  left: TerminalStreamEvents,
  right: TerminalStreamEvents,
): TerminalStreamEvents => {
  const eventTypes = new Set(left.map((event) => event.type));
  return [...left, ...right.filter((event) => !eventTypes.has(event.type))];
};

export const createTerminalSessionStream = () => {
  const publish = (
    attachment: TerminalAttachment,
    event: TerminalServerMessage,
    payload: Uint8Array = EMPTY_PAYLOAD,
  ): void => attachment.sink(event, payload);

  const tryPublish = (
    session: TerminalSession,
    attachment: TerminalAttachment,
    event: TerminalServerMessage,
    payload: Uint8Array = EMPTY_PAYLOAD,
  ): { delivered: boolean; events: TerminalStreamEvents } => {
    try {
      publish(attachment, event, payload);
      return { delivered: true, events: [] };
    } catch {
      session.attachments.delete(attachment.attachmentId);
      return {
        delivered: false,
        events: session.attachments.size === 0 ? streamEvent("attachments_empty") : [],
      };
    }
  };

  const publishSafely = (
    session: TerminalSession,
    attachment: TerminalAttachment,
    event: TerminalServerMessage,
    payload: Uint8Array = EMPTY_PAYLOAD,
  ): TerminalStreamEvents => tryPublish(session, attachment, event, payload).events;

  const appendReplay = (session: TerminalSession, chunk: ReplayChunk): void => {
    session.replay.push(chunk);
    session.replayBytes += chunk.data.byteLength;
    while (session.replayBytes > TERMINAL_LIMITS.replayBytes) {
      const removed = session.replay.shift();
      if (!removed) {
        break;
      }
      session.replayBytes -= removed.data.byteLength;
    }
  };

  const requestPause = (session: TerminalSession): TerminalStreamEvents => {
    if (session.paused || !session.handle) return [];
    if (!session.handle.supportsOutputPause) {
      return streamEvent("overflow");
    }
    session.paused = true;
    return streamEvent("pause_requested");
  };

  const deliverChunk = (
    session: TerminalSession,
    attachment: TerminalAttachment,
    chunk: ReplayChunk,
    replay: boolean,
  ): { delivered: boolean; events: TerminalStreamEvents } => {
    if (chunk.sequenceEnd <= attachment.deliveredSequence) {
      return { delivered: true, events: [] };
    }
    const start = Math.max(chunk.sequenceStart, attachment.deliveredSequence);
    const payload = chunk.data.subarray(start - chunk.sequenceStart);
    if (attachment.pendingBytes + payload.byteLength > TERMINAL_LIMITS.pendingOutputBytes) {
      return { delivered: false, events: requestPause(session) };
    }
    const published = tryPublish(
      session,
      attachment,
      {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "output",
        terminalId: session.summary.terminalId,
        sequenceStart: start,
        sequenceEnd: chunk.sequenceEnd,
        replay,
      },
      payload,
    );
    if (!published.delivered) return published;
    attachment.deliveredSequence = chunk.sequenceEnd;
    attachment.pendingBytes = attachment.deliveredSequence - attachment.acknowledgedSequence;
    const pressureEvents =
      attachment.pendingBytes >= TERMINAL_LIMITS.pendingOutputBytes ? requestPause(session) : [];
    return {
      delivered: true,
      events: mergeStreamEvents(published.events, pressureEvents),
    };
  };

  const flushAttachment = (
    session: TerminalSession,
    attachment: TerminalAttachment,
    replay: boolean,
  ): TerminalStreamEvents => {
    let events: TerminalStreamEvents = [];
    const earliest = session.replay[0]?.sequenceStart ?? session.nextSequence;
    if (attachment.deliveredSequence < earliest) {
      const published = tryPublish(session, attachment, {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "replay_gap",
        terminalId: session.summary.terminalId,
        missingSequenceStart: attachment.deliveredSequence,
        missingSequenceEnd: earliest,
      });
      events = mergeStreamEvents(events, published.events);
      if (!published.delivered) return events;
      attachment.deliveredSequence = earliest;
      attachment.acknowledgedSequence = earliest;
      attachment.pendingBytes = 0;
      events = mergeStreamEvents(events, streamEvent("incomplete_replay"));
    }
    for (const chunk of session.replay) {
      const delivered = deliverChunk(session, attachment, chunk, replay);
      events = mergeStreamEvents(events, delivered.events);
      if (!delivered.delivered) break;
    }
    return events;
  };

  const handleOutput = (session: TerminalSession, data: Uint8Array): TerminalStreamEvents => {
    let events: TerminalStreamEvents = [];
    if (data.byteLength === 0 || session.overflowed) {
      return events;
    }
    for (let offset = 0; offset < data.byteLength; offset += OUTPUT_CHUNK_BYTES) {
      const bytes = data.slice(offset, Math.min(data.byteLength, offset + OUTPUT_CHUNK_BYTES));
      const chunk = {
        sequenceStart: session.nextSequence,
        sequenceEnd: session.nextSequence + bytes.byteLength,
        data: bytes,
      };
      session.nextSequence = chunk.sequenceEnd;
      appendReplay(session, chunk);
      for (const attachment of session.attachments.values()) {
        const delivered = deliverChunk(session, attachment, chunk, false);
        events = mergeStreamEvents(events, delivered.events);
      }
      if (events.some((event) => event.type === "overflow")) return events;
    }
    return events;
  };

  const resumeOutputIfUnblocked = (
    session: TerminalSession,
  ): Effect.Effect<
    TerminalStreamEvents,
    import("../../ports/terminal-pty-port").TerminalPtyError
  > =>
    Effect.gen(function* () {
      if (
        !session.paused ||
        ![...session.attachments.values()].every(
          (candidate) => candidate.pendingBytes <= TERMINAL_LIMITS.resumeOutputBytes,
        )
      ) {
        return [];
      }
      if (session.handle) {
        yield* session.handle.resumeOutput();
      }
      session.paused = false;
      let events: TerminalStreamEvents = [];
      for (const candidate of session.attachments.values()) {
        events = mergeStreamEvents(events, flushAttachment(session, candidate, false));
      }
      return events;
    });

  return {
    flushAttachment,
    handleOutput,
    publish,
    publishSafely,
    resumeOutputIfUnblocked,
  };
};

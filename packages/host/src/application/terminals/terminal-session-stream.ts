import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalServerMessage,
  type TerminalSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TerminalPtyError, TerminalPtyHandle } from "../../ports/terminal-pty-port";
import { TERMINAL_LIMITS } from "./terminal-limits";
import type { TerminalServiceError } from "./terminal-service-error";

const OUTPUT_CHUNK_BYTES = 64 * 1024;
const EMPTY_PAYLOAD = new Uint8Array(0);

export type ReplayChunk = {
  sequenceStart: number;
  sequenceEnd: number;
  data: Uint8Array;
};

export type TerminalAttachment = {
  attachmentId: string;
  sink: (event: TerminalServerMessage, payload: Uint8Array) => void;
  acknowledgedSequence: number;
  deliveredSequence: number;
  pendingBytes: number;
};

export type TerminalSession = {
  summary: TerminalSummary;
  handle: TerminalPtyHandle | null;
  replay: ReplayChunk[];
  replayBytes: number;
  nextSequence: number;
  attachments: Map<string, TerminalAttachment>;
  paused: boolean;
  overflowed: boolean;
  operations: Effect.Semaphore;
};

export type TerminalSessionAttachInput = {
  terminalId: string;
  attachmentId: string;
  lastConsumedSequence: number | null;
  sink: TerminalAttachment["sink"];
};

export const isLiveTerminal = (session: TerminalSession): boolean =>
  session.summary.lifecycle === "starting" ||
  session.summary.lifecycle === "running" ||
  session.summary.lifecycle === "closing" ||
  session.summary.lifecycle === "close_failed";

type CreateTerminalSessionStreamInput = {
  emitLifecycle: (session: TerminalSession) => void;
  handleExit: (session: TerminalSession, exitCode: number | null, signal: string | null) => void;
  handleFailure: (session: TerminalSession) => void;
  resumeFailure: (
    session: TerminalSession,
    operation: "ack" | "detach",
    cause: TerminalPtyError,
  ) => TerminalServiceError;
};

export const createTerminalSessionStream = ({
  emitLifecycle,
  handleExit,
  handleFailure,
  resumeFailure,
}: CreateTerminalSessionStreamInput) => {
  const publish = (
    attachment: TerminalAttachment,
    event: TerminalServerMessage,
    payload: Uint8Array = EMPTY_PAYLOAD,
  ): void => attachment.sink(event, payload);

  const publishSafely = (
    session: TerminalSession,
    attachment: TerminalAttachment,
    event: TerminalServerMessage,
    payload: Uint8Array = EMPTY_PAYLOAD,
  ): boolean => {
    try {
      publish(attachment, event, payload);
      return true;
    } catch {
      session.attachments.delete(attachment.attachmentId);
      if (session.attachments.size === 0) {
        session.summary.connectionState = "disconnected";
      }
      return false;
    }
  };

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

  const terminateForOverflow = (session: TerminalSession): void => {
    if (session.overflowed) {
      return;
    }
    session.overflowed = true;
    session.summary.attentionState = "overflow";
    for (const attachment of session.attachments.values()) {
      publishSafely(session, attachment, {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "output_overflow",
        terminalId: session.summary.terminalId,
      });
    }
    if (session.handle) {
      session.summary.lifecycle = "closing";
      emitLifecycle(session);
      Effect.runFork(
        session.handle.terminate().pipe(
          Effect.tap(() => Effect.sync(() => handleExit(session, null, "output_overflow"))),
          Effect.tapError(() => Effect.sync(() => handleFailure(session))),
        ),
      );
    }
  };

  const pause = (session: TerminalSession): void => {
    if (session.paused || !session.handle) {
      return;
    }
    if (!session.handle.supportsOutputPause) {
      terminateForOverflow(session);
      return;
    }
    session.paused = true;
    Effect.runFork(
      session.handle
        .pauseOutput()
        .pipe(Effect.tapError(() => Effect.sync(() => terminateForOverflow(session)))),
    );
  };

  const deliverChunk = (
    session: TerminalSession,
    attachment: TerminalAttachment,
    chunk: ReplayChunk,
    replay: boolean,
  ): boolean => {
    if (chunk.sequenceEnd <= attachment.deliveredSequence) {
      return true;
    }
    const start = Math.max(chunk.sequenceStart, attachment.deliveredSequence);
    const payload = chunk.data.subarray(start - chunk.sequenceStart);
    if (attachment.pendingBytes + payload.byteLength > TERMINAL_LIMITS.pendingOutputBytes) {
      pause(session);
      return false;
    }
    if (
      !publishSafely(
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
      )
    ) {
      return false;
    }
    attachment.deliveredSequence = chunk.sequenceEnd;
    attachment.pendingBytes = attachment.deliveredSequence - attachment.acknowledgedSequence;
    if (attachment.pendingBytes >= TERMINAL_LIMITS.pendingOutputBytes) {
      pause(session);
    }
    return true;
  };

  const flushAttachment = (
    session: TerminalSession,
    attachment: TerminalAttachment,
    replay: boolean,
  ): void => {
    const earliest = session.replay[0]?.sequenceStart ?? session.nextSequence;
    if (attachment.deliveredSequence < earliest) {
      if (
        !publishSafely(session, attachment, {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "replay_gap",
          terminalId: session.summary.terminalId,
          missingSequenceStart: attachment.deliveredSequence,
          missingSequenceEnd: earliest,
        })
      ) {
        return;
      }
      attachment.deliveredSequence = earliest;
      attachment.acknowledgedSequence = earliest;
      attachment.pendingBytes = 0;
      session.summary.connectionState = "incomplete_replay";
      session.summary.attentionState = "incomplete_replay";
    }
    for (const chunk of session.replay) {
      if (!deliverChunk(session, attachment, chunk, replay)) {
        break;
      }
    }
  };

  const handleOutput = (session: TerminalSession, data: Uint8Array): void => {
    if (data.byteLength === 0 || session.overflowed) {
      return;
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
        deliverChunk(session, attachment, chunk, false);
      }
      if (session.overflowed) {
        return;
      }
    }
  };

  const resumeOutputIfUnblocked = (
    session: TerminalSession,
    operation: "ack" | "detach",
  ): Effect.Effect<void, TerminalServiceError> =>
    Effect.gen(function* () {
      if (
        !session.paused ||
        ![...session.attachments.values()].every(
          (candidate) => candidate.pendingBytes <= TERMINAL_LIMITS.resumeOutputBytes,
        )
      ) {
        return;
      }
      if (session.handle) {
        yield* session.handle
          .resumeOutput()
          .pipe(Effect.mapError((cause) => resumeFailure(session, operation, cause)));
      }
      session.paused = false;
      for (const candidate of session.attachments.values()) {
        flushAttachment(session, candidate, false);
      }
    });

  return {
    flushAttachment,
    handleOutput,
    publish,
    publishSafely,
    resumeOutputIfUnblocked,
  };
};

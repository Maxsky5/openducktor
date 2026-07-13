import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalServerMessage,
  type TerminalSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TerminalPtyHandle } from "../../ports/terminal-pty-port";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { TerminalServiceError } from "./terminal-service-error";

const OUTPUT_CHUNK_BYTES = 64 * 1024;
const EMPTY_PAYLOAD = new Uint8Array(0);

export type ReplayChunk = { sequenceStart: number; sequenceEnd: number; data: Uint8Array };
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

type TerminalOperation = ConstructorParameters<typeof TerminalServiceError>[0]["operation"];

export const terminalFailure = (
  code: ConstructorParameters<typeof TerminalServiceError>[0]["code"],
  operation: TerminalOperation,
  message: string,
  terminalId?: string,
  cause?: unknown,
): TerminalServiceError =>
  new TerminalServiceError({
    code,
    operation,
    message,
    ...(terminalId ? { terminalId } : {}),
    ...(cause !== undefined ? { cause } : {}),
  });

export const terminalOperationFailure = (
  cause: unknown,
  operation: TerminalOperation,
): TerminalServiceError =>
  cause instanceof TerminalServiceError
    ? cause
    : terminalFailure(
        "protocol_error",
        operation,
        `Terminal ${operation} failed unexpectedly.`,
        undefined,
        cause,
      );

export const isLiveTerminal = (session: TerminalSession): boolean =>
  session.summary.lifecycle === "starting" ||
  session.summary.lifecycle === "running" ||
  session.summary.lifecycle === "closing" ||
  session.summary.lifecycle === "close_failed";

export const createTerminalSessionEngine = ({ now }: { now: () => Date }) => {
  const sessions = new Map<string, TerminalSession>();

  const getSession = (terminalId: string, operation: TerminalOperation): TerminalSession => {
    const session = sessions.get(terminalId);
    if (!session) {
      throw terminalFailure(
        "terminal_not_found",
        operation,
        `Terminal not found: ${terminalId}`,
        terminalId,
      );
    }
    return session;
  };

  const publish = (
    attachment: TerminalAttachment,
    event: TerminalServerMessage,
    payload: Uint8Array = EMPTY_PAYLOAD,
  ): void => attachment.sink(event, payload);

  const emitLifecycle = (session: TerminalSession): void => {
    for (const attachment of session.attachments.values()) {
      publish(attachment, {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "lifecycle",
        terminalId: session.summary.terminalId,
        lifecycle: session.summary.lifecycle,
        ...(session.summary.exit
          ? {
              finalSequence: session.summary.exit.finalSequence,
              exitCode: session.summary.exit.exitCode,
              signal: session.summary.exit.signal,
            }
          : {}),
      });
    }
  };

  const handleFailure = (session: TerminalSession): void => {
    session.summary.lifecycle = "close_failed";
    session.summary.attentionState = "close_failed";
    emitLifecycle(session);
  };

  const pruneExited = (): void => {
    const cutoff = now().getTime() - TERMINAL_LIMITS.exitedRetentionMs;
    const exited = [...sessions.values()]
      .filter((session) => !isLiveTerminal(session))
      .sort((left, right) => left.summary.createdAt.localeCompare(right.summary.createdAt));
    const expired = exited.filter(
      (session) =>
        new Date(session.summary.exit?.exitedAt ?? session.summary.createdAt).getTime() < cutoff,
    );
    const overCapacity = exited.slice(
      0,
      Math.max(0, exited.length - TERMINAL_LIMITS.retainedExited),
    );
    for (const session of new Set([...expired, ...overCapacity])) {
      for (const attachment of session.attachments.values()) {
        publish(attachment, {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "terminal_forgotten",
          terminalId: session.summary.terminalId,
        });
      }
      sessions.delete(session.summary.terminalId);
    }
  };

  const appendReplay = (session: TerminalSession, chunk: ReplayChunk): void => {
    session.replay.push(chunk);
    session.replayBytes += chunk.data.byteLength;
    while (session.replayBytes > TERMINAL_LIMITS.replayBytes) {
      const removed = session.replay.shift();
      if (!removed) break;
      session.replayBytes -= removed.data.byteLength;
    }
  };

  const terminateForOverflow = (session: TerminalSession): void => {
    if (session.overflowed) return;
    session.overflowed = true;
    session.summary.attentionState = "overflow";
    for (const attachment of session.attachments.values()) {
      publish(attachment, {
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
    if (session.paused || !session.handle) return;
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
    if (chunk.sequenceEnd <= attachment.deliveredSequence) return true;
    const start = Math.max(chunk.sequenceStart, attachment.deliveredSequence);
    const payload = chunk.data.subarray(start - chunk.sequenceStart);
    if (attachment.pendingBytes + payload.byteLength > TERMINAL_LIMITS.pendingOutputBytes) {
      pause(session);
      return false;
    }
    publish(
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
    attachment.deliveredSequence = chunk.sequenceEnd;
    attachment.pendingBytes = attachment.deliveredSequence - attachment.acknowledgedSequence;
    if (attachment.pendingBytes >= TERMINAL_LIMITS.pendingOutputBytes) pause(session);
    return true;
  };

  const flushAttachment = (
    session: TerminalSession,
    attachment: TerminalAttachment,
    replay: boolean,
  ): void => {
    const earliest = session.replay[0]?.sequenceStart ?? session.nextSequence;
    if (attachment.deliveredSequence < earliest) {
      publish(attachment, {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "replay_gap",
        terminalId: session.summary.terminalId,
        missingSequenceStart: attachment.deliveredSequence,
        missingSequenceEnd: earliest,
      });
      attachment.deliveredSequence = earliest;
      attachment.acknowledgedSequence = earliest;
      attachment.pendingBytes = 0;
      session.summary.connectionState = "incomplete_replay";
      session.summary.attentionState = "incomplete_replay";
    }
    for (const chunk of session.replay) {
      if (!deliverChunk(session, attachment, chunk, replay)) break;
    }
  };

  const handleOutput = (session: TerminalSession, data: Uint8Array): void => {
    if (data.byteLength === 0 || session.overflowed) return;
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
      if (session.overflowed) return;
    }
  };

  const handleExit = (
    session: TerminalSession,
    exitCode: number | null,
    signal: string | null,
  ): void => {
    if (session.summary.lifecycle === "exited") return;
    session.handle = null;
    session.summary.lifecycle = "exited";
    if (!session.overflowed) session.summary.attentionState = "exited";
    session.summary.exit = {
      exitCode,
      signal,
      finalSequence: session.nextSequence,
      exitedAt: now().toISOString(),
    };
    emitLifecycle(session);
    pruneExited();
  };

  const closeSession = (session: TerminalSession, confirmTerminate: boolean) =>
    Effect.gen(function* () {
      const terminalId = session.summary.terminalId;
      if (isLiveTerminal(session) && !confirmTerminate) {
        return yield* Effect.fail(
          terminalFailure(
            "confirmation_required",
            "close",
            `Terminal ${session.summary.label} is still running.`,
            terminalId,
          ),
        );
      }
      if (session.handle) {
        session.summary.lifecycle = "closing";
        emitLifecycle(session);
        const result = yield* Effect.either(session.handle.terminate());
        if (result._tag === "Left") {
          session.summary.lifecycle = "close_failed";
          session.summary.attentionState = "close_failed";
          emitLifecycle(session);
          return yield* Effect.fail(
            terminalFailure(
              "close_failed",
              "close",
              `Failed to terminate terminal ${terminalId}.`,
              terminalId,
              result.left,
            ),
          );
        }
      }
      sessions.delete(terminalId);
    });

  return {
    sessions,
    getSession,
    publish,
    pruneExited,
    flushAttachment,
    handleOutput,
    handleExit,
    handleFailure,
    closeSession,
  };
};

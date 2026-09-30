import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TerminalService } from "./terminal-service";
import { TerminalServiceError, terminalServiceErrorToFailure } from "./terminal-service-error";

export type TerminalClientSession = {
  handle(message: TerminalClientMessage, payload: Uint8Array): Effect.Effect<void>;
  close(): Effect.Effect<void, TerminalServiceError>;
};

export const createTerminalClientSession = ({
  clientId,
  terminalService,
  send,
}: {
  clientId: string;
  terminalService: Pick<TerminalService, "acknowledge" | "attach" | "detach" | "resize" | "write">;
  send(message: TerminalServerMessage, payload: Uint8Array): void;
}): TerminalClientSession => {
  const attachedTerminalIds = new Set<string>();
  const operations = Effect.unsafeMakeSemaphore(1);
  let closed = false;
  const attachmentId = (terminalId: string): string => `${clientId}:${terminalId}`;
  const sendFailure = (
    error: TerminalServiceError,
    message: TerminalClientMessage,
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      const failure = terminalServiceErrorToFailure(error);
      send(
        {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "protocol_error",
          terminalId: message.terminalId,
          failure: {
            ...failure,
            code:
              message.type === "attach" && failure.code === "terminal_not_found"
                ? "terminal_forgotten"
                : failure.code,
            terminalId: message.terminalId,
          },
        },
        new Uint8Array(),
      );
    });
  const handleMessage = (
    message: TerminalClientMessage,
    payload: Uint8Array,
  ): Effect.Effect<void> => {
    if (closed) {
      return sendFailure(
        new TerminalServiceError({
          code: "protocol_error",
          operation: message.type === "input" ? "write" : message.type,
          message:
            "Terminal client connection is closed. Reconnect before sending terminal frames.",
          terminalId: message.terminalId,
        }),
        message,
      );
    }
    const id = attachmentId(message.terminalId);
    const operation = (() => {
      if (message.type === "attach") {
        return terminalService
          .attach({
            terminalId: message.terminalId,
            attachmentId: id,
            lastConsumedSequence: message.lastConsumedSequence,
            sink: send,
          })
          .pipe(Effect.tap(() => Effect.sync(() => attachedTerminalIds.add(message.terminalId))));
      }
      if (message.type === "input") return terminalService.write(message.terminalId, payload);
      if (message.type === "resize") {
        return terminalService.resize(message.terminalId, {
          columns: message.columns,
          rows: message.rows,
        });
      }
      if (message.type === "ack") {
        return terminalService.acknowledge(message.terminalId, id, message.sequenceEnd);
      }
      return terminalService
        .detach(message.terminalId, id)
        .pipe(Effect.tap(() => Effect.sync(() => attachedTerminalIds.delete(message.terminalId))));
    })();
    return operation.pipe(
      Effect.catchTag("TerminalServiceError", (error) => sendFailure(error, message)),
    );
  };
  const close = (): Effect.Effect<void, TerminalServiceError> =>
    operations.withPermits(1)(
      Effect.gen(function* () {
        closed = true;
        const terminalIds = [...attachedTerminalIds];
        let firstFailure: TerminalServiceError | undefined;
        for (const terminalId of terminalIds) {
          const result = yield* Effect.either(
            terminalService.detach(terminalId, attachmentId(terminalId)),
          );
          if (result._tag === "Left" && result.left.code !== "terminal_not_found") {
            firstFailure ??= result.left;
            continue;
          }
          attachedTerminalIds.delete(terminalId);
        }
        if (firstFailure) return yield* Effect.fail(firstFailure);
      }),
    );

  return {
    handle: (message, payload) =>
      operations.withPermits(1)(Effect.suspend(() => handleMessage(message, payload))),
    close,
  };
};

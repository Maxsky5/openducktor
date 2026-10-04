import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TerminalService } from "./terminal-service";
import { TerminalServiceError, terminalServiceErrorToFailure } from "./terminal-service-error";
import { createSerialLane } from "../../effect/serial-gate";

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
  terminalService: Pick<
    TerminalService,
    "acknowledge" | "attach" | "detach" | "resize" | "write" | "observeActivity"
  >;
  send(message: TerminalServerMessage, payload: Uint8Array): void;
}): TerminalClientSession => {
  const attachedTerminalIds = new Set<string>();
  const operations = createSerialLane();
  let closed = false;
  let stopActivity: (() => void) | null = null;
  const attachmentId = (terminalId: string): string => `${clientId}:${terminalId}`;
  const sendFailure = (
    error: TerminalServiceError,
    message: TerminalClientMessage,
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      const failure = terminalServiceErrorToFailure(error);
      const response: Extract<TerminalServerMessage, { type: "protocol_error" }> = {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "protocol_error",
        failure: {
          ...failure,
          code:
            message.type === "attach" && failure.code === "terminal_not_found"
              ? "terminal_forgotten"
              : failure.code,
        },
      };
      if ("terminalId" in message) {
        response.terminalId = message.terminalId;
        response.failure.terminalId = message.terminalId;
      }
      send(response, new Uint8Array());
    });
  const handleMessage = (
    message: TerminalClientMessage,
    payload: Uint8Array,
  ): Effect.Effect<void> => {
    if (closed) {
      const failure: ConstructorParameters<typeof TerminalServiceError>[0] = {
        code: "protocol_error",
        operation:
          "terminalId" in message ? (message.type === "input" ? "write" : message.type) : "list",
        message: "Terminal client connection is closed. Reconnect before sending terminal frames.",
      };
      return sendFailure(
        new TerminalServiceError(
          "terminalId" in message ? { ...failure, terminalId: message.terminalId } : failure,
        ),
        message,
      );
    }
    if (message.type === "observe_activity") {
      return Effect.gen(function* () {
        stopActivity?.();
        stopActivity = yield* terminalService.observeActivity((event) =>
          send(event, new Uint8Array()),
        );
      });
    }
    if (message.type === "unobserve_activity") {
      return Effect.sync(() => {
        stopActivity?.();
        stopActivity = null;
      });
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
    operations.run(
      Effect.gen(function* () {
        closed = true;
        stopActivity?.();
        stopActivity = null;
        const terminalIds = [...attachedTerminalIds];
        let firstFailure: TerminalServiceError | undefined;
        for (const terminalId of terminalIds) {
          const result = yield* Effect.result(
            terminalService.detach(terminalId, attachmentId(terminalId)),
          );
          if (result._tag === "Failure" && result.failure.code !== "terminal_not_found") {
            firstFailure ??= result.failure;
            continue;
          }
          attachedTerminalIds.delete(terminalId);
        }
        if (firstFailure) return yield* Effect.fail(firstFailure);
      }),
    );

  return {
    handle: (message, payload) =>
      operations.run(Effect.suspend(() => handleMessage(message, payload))),
    close,
  };
};

import {
  encodeTerminalListSummary,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalClientMessage,
  type TerminalServerMessage,
  type TerminalListMessage,
  type TerminalSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TerminalService } from "./terminal-service";
import { TerminalServiceError, terminalServiceErrorToFailure } from "./terminal-service-error";
import { createSerialLane } from "../../effect/serial-gate";
import { TERMINAL_LIMITS } from "./terminal-limits";

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
    "acknowledge" | "attach" | "detach" | "resize" | "write" | "observeActivity" | "observeList"
  >;
  send(message: TerminalServerMessage, payload: Uint8Array): void;
}): TerminalClientSession => {
  const attachedTerminalIds = new Set<string>();
  const operations = createSerialLane();
  let closed = false;
  let stopActivity: (() => void) | null = null;
  const listObservers = new Map<string, () => void>();
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
    if (message.type === "observe_list") {
      if (
        !listObservers.has(message.subscriptionId) &&
        listObservers.size >= TERMINAL_LIMITS.listSubscriptionsPerClient
      )
        return sendFailure(
          new TerminalServiceError({
            code: "protocol_error",
            operation: "list",
            message:
              "The terminal list subscription limit has been reached. Close unused terminal views, then reconnect.",
          }),
          message,
        );
      return Effect.gen(function* () {
        const { subscriptionId, filter } = message;
        listObservers.get(subscriptionId)?.();
        listObservers.delete(subscriptionId);
        let failed = false;
        const deliver = (event: TerminalListMessage, summary?: TerminalSummary): void => {
          if (failed) return;
          try {
            send(
              event,
              summary === undefined ? new Uint8Array() : encodeTerminalListSummary(summary),
            );
          } catch (cause) {
            failed = true;
            listObservers.get(subscriptionId)?.();
            listObservers.delete(subscriptionId);
            send(
              {
                version: TERMINAL_PROTOCOL_VERSION,
                type: "protocol_error",
                failure: {
                  code: "protocol_error",
                  message: `Terminal list delivery failed. ${cause instanceof Error ? cause.message : String(cause)} Reconnect after you resolve the host error.`,
                },
              },
              new Uint8Array(),
            );
          }
        };
        const updated = (summary: TerminalSummary, revision: number): void =>
          deliver(
            { version: TERMINAL_PROTOCOL_VERSION, type: "list_updated", subscriptionId, revision },
            summary,
          );
        const stop = yield* terminalService.observeList(filter, {
          snapshot: (list) => {
            deliver({
              version: TERMINAL_PROTOCOL_VERSION,
              type: "list_snapshot_start",
              subscriptionId,
              hostInstanceId: list.hostInstanceId,
              revision: list.revision,
            });
            for (const summary of list.terminals) updated(summary, list.revision);
            deliver({
              version: TERMINAL_PROTOCOL_VERSION,
              type: "list_snapshot_end",
              subscriptionId,
            });
          },
          updated,
          removed: (terminalId, revision) =>
            deliver({
              version: TERMINAL_PROTOCOL_VERSION,
              type: "list_removed",
              subscriptionId,
              terminalId,
              revision,
            }),
        });
        if (failed) stop();
        else listObservers.set(subscriptionId, stop);
      }).pipe(Effect.catchTag("TerminalServiceError", (error) => sendFailure(error, message)));
    }
    if (message.type === "unobserve_list") {
      return Effect.sync(() => {
        listObservers.get(message.subscriptionId)?.();
        listObservers.delete(message.subscriptionId);
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
        for (const stop of listObservers.values()) stop();
        listObservers.clear();
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

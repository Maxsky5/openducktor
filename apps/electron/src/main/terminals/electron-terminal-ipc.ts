import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  type TerminalClientMessage,
} from "@openducktor/contracts";
import type { TerminalService, TerminalServiceError } from "@openducktor/host";
import { Effect } from "effect";
import { ElectronValidationError } from "../../effect/electron-errors";
import { ELECTRON_TERMINAL_EVENT_CHANNEL } from "../../shared/electron-bridge-contract";

export type ElectronTerminalSender = {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, frame: Uint8Array): void;
};

const isClientMessage = (message: { type: string }): message is TerminalClientMessage =>
  message.type === "attach" ||
  message.type === "input" ||
  message.type === "resize" ||
  message.type === "ack" ||
  message.type === "detach";

export const createElectronTerminalIpcController = (terminalService: TerminalService) => {
  const attachedBySender = new Map<number, Set<string>>();
  const attachmentId = (senderId: number, terminalId: string): string =>
    `electron:${senderId}:${terminalId}`;
  const detachSender = (senderId: number): Effect.Effect<void, TerminalServiceError> =>
    Effect.gen(function* () {
      const terminalIds = attachedBySender.get(senderId) ?? new Set();
      attachedBySender.delete(senderId);
      for (const terminalId of terminalIds) {
        yield* terminalService
          .detach(terminalId, attachmentId(senderId, terminalId))
          .pipe(
            Effect.catchTag("TerminalServiceError", (error) =>
              error.code === "terminal_not_found" ? Effect.void : Effect.fail(error),
            ),
          );
      }
    });
  const handleFrame = (
    sender: ElectronTerminalSender,
    rawFrame: unknown,
  ): Effect.Effect<void, TerminalServiceError | ElectronValidationError> =>
    Effect.gen(function* () {
      if (!(rawFrame instanceof Uint8Array)) {
        return yield* Effect.fail(
          new ElectronValidationError({
            operation: "electron.terminal.decode",
            field: "frame",
            message: "Electron terminal frames must be Uint8Array values.",
          }),
        );
      }
      const frame = yield* Effect.try({
        try: () => decodeTerminalProtocolFrame(rawFrame),
        catch: (cause) =>
          new ElectronValidationError({
            operation: "electron.terminal.decode",
            field: "frame",
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      if (!isClientMessage(frame.message)) {
        return yield* Effect.fail(
          new ElectronValidationError({
            operation: "electron.terminal.direction",
            field: "type",
            message: "Renderer terminal traffic must use a client message type.",
          }),
        );
      }
      const message = frame.message;
      const id = attachmentId(sender.id, message.terminalId);
      if (message.type === "attach") {
        const attached = attachedBySender.get(sender.id) ?? new Set<string>();
        attached.add(message.terminalId);
        attachedBySender.set(sender.id, attached);
        return yield* terminalService.attach({
          terminalId: message.terminalId,
          attachmentId: id,
          lastConsumedSequence: message.lastConsumedSequence,
          sink: (event, payload) => {
            if (!sender.isDestroyed()) {
              sender.send(
                ELECTRON_TERMINAL_EVENT_CHANNEL,
                encodeTerminalProtocolFrame({ message: event, payload }),
              );
            }
          },
        });
      }
      if (message.type === "input") {
        return yield* terminalService.write(message.terminalId, frame.payload);
      }
      if (message.type === "resize") {
        return yield* terminalService.resize(message.terminalId, {
          columns: message.columns,
          rows: message.rows,
        });
      }
      if (message.type === "ack") {
        return yield* terminalService.acknowledge(message.terminalId, id, message.sequenceEnd);
      }
      const attached = attachedBySender.get(sender.id);
      attached?.delete(message.terminalId);
      return yield* terminalService.detach(message.terminalId, id);
    });
  return { detachSender, handleFrame };
};

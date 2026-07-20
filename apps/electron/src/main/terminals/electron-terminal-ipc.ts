import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  isTerminalClientMessage,
} from "@openducktor/contracts";
import {
  createTerminalClientSession,
  type TerminalClientSession,
  type TerminalService,
  type TerminalServiceError,
} from "@openducktor/host";
import { Effect } from "effect";
import { ElectronValidationError } from "../../effect/electron-errors";
import {
  ELECTRON_TERMINAL_EVENT_CHANNEL,
  type ElectronTerminalEventEnvelope,
} from "../../shared/electron-bridge-contract";

const MAX_CLIENT_ID_LENGTH = 128;

export type ElectronTerminalSender = {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, envelope: ElectronTerminalEventEnvelope): void;
};

const readClientId = (clientId: unknown): Effect.Effect<string, ElectronValidationError> =>
  typeof clientId === "string" && clientId.length > 0 && clientId.length <= MAX_CLIENT_ID_LENGTH
    ? Effect.succeed(clientId)
    : Effect.fail(
        new ElectronValidationError({
          operation: "electron.terminal.client",
          field: "clientId",
          message: "Electron terminal client IDs must contain between 1 and 128 characters.",
        }),
      );

export const shouldDetachTerminalSenderForNavigation = (details: {
  isMainFrame: boolean;
  isSameDocument: boolean;
}): boolean => details.isMainFrame && !details.isSameDocument;

export const createElectronTerminalIpcController = (terminalService: TerminalService) => {
  const clientsBySender = new Map<number, Map<string, TerminalClientSession>>();
  const getClient = (sender: ElectronTerminalSender, clientId: string): TerminalClientSession => {
    const senderClients =
      clientsBySender.get(sender.id) ?? new Map<string, TerminalClientSession>();
    const existing = senderClients.get(clientId);
    if (existing) return existing;
    const client = createTerminalClientSession({
      clientId: `electron:${sender.id}:${clientId}`,
      terminalService,
      send: (message, payload) => {
        if (sender.isDestroyed()) return;
        sender.send(ELECTRON_TERMINAL_EVENT_CHANNEL, {
          clientId,
          frame: encodeTerminalProtocolFrame({ message, payload }),
        });
      },
    });
    senderClients.set(clientId, client);
    clientsBySender.set(sender.id, senderClients);
    return client;
  };
  const handleFrame = (
    sender: ElectronTerminalSender,
    rawClientId: unknown,
    rawFrame: unknown,
  ): Effect.Effect<void, ElectronValidationError> =>
    Effect.gen(function* () {
      const clientId = yield* readClientId(rawClientId);
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
      if (!isTerminalClientMessage(frame.message)) {
        return yield* Effect.fail(
          new ElectronValidationError({
            operation: "electron.terminal.direction",
            field: "type",
            message: "Renderer terminal traffic must use a client message type.",
          }),
        );
      }
      yield* getClient(sender, clientId).handle(frame.message, frame.payload);
    });
  const detachClient = (
    senderId: number,
    rawClientId: unknown,
  ): Effect.Effect<void, TerminalServiceError | ElectronValidationError> =>
    Effect.gen(function* () {
      const clientId = yield* readClientId(rawClientId);
      const senderClients = clientsBySender.get(senderId);
      if (!senderClients) return;
      const client = senderClients.get(clientId);
      if (!client) return;
      yield* client.close();
      senderClients.delete(clientId);
      if (senderClients.size === 0) clientsBySender.delete(senderId);
    });
  const detachSender = (senderId: number): Effect.Effect<void, TerminalServiceError> =>
    Effect.gen(function* () {
      const clients = [...(clientsBySender.get(senderId)?.values() ?? [])];
      clientsBySender.delete(senderId);
      yield* Effect.forEach(clients, (client) => client.close(), { concurrency: 1 });
    });

  return { detachClient, detachSender, handleFrame };
};

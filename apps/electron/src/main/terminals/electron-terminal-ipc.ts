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
import { runElectronEffect } from "../../effect/electron-boundary";
import { ElectronValidationError, jsonIssues } from "../../effect/electron-errors";
import {
  ELECTRON_TERMINAL_DISCONNECT_CHANNEL,
  ELECTRON_TERMINAL_EVENT_CHANNEL,
  ELECTRON_TERMINAL_SEND_CHANNEL,
  type ElectronTerminalEventEnvelope,
} from "../../shared/electron-bridge-contract";
import { z } from "zod";

const MAX_CLIENT_ID_LENGTH = 128;

const electronTerminalClientIdSchema = z.string().min(1).max(MAX_CLIENT_ID_LENGTH);
const electronTerminalFrameSchema = z.instanceof(Uint8Array);
const electronTerminalSendRequestSchema = z
  .object({
    clientId: electronTerminalClientIdSchema,
    frame: electronTerminalFrameSchema,
  })
  .strict();
type ElectronTerminalSendRequest = z.infer<typeof electronTerminalSendRequestSchema>;

type ElectronTerminalNavigationDetails = {
  isMainFrame: boolean;
  isSameDocument: boolean;
};

export type ElectronTerminalSender = {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, envelope: ElectronTerminalEventEnvelope): void;
};

type ElectronTerminalLifecycleSender = ElectronTerminalSender & {
  on(
    event: "did-start-navigation",
    listener: (details: ElectronTerminalNavigationDetails) => void,
  ): void;
  once(event: "destroyed", listener: () => void): void;
};

type ElectronTerminalInvokeEvent = {
  readonly sender: ElectronTerminalLifecycleSender;
};

type ElectronTerminalIpcMain = {
  handle(
    channel: typeof ELECTRON_TERMINAL_SEND_CHANNEL,
    listener: (
      event: ElectronTerminalInvokeEvent,
      request: ElectronTerminalSendRequest,
    ) => Promise<void>,
  ): void;
  handle(
    channel: typeof ELECTRON_TERMINAL_DISCONNECT_CHANNEL,
    listener: (event: ElectronTerminalInvokeEvent, clientId: string) => Promise<void>,
  ): void;
};

type RegisterElectronTerminalIpcInput = {
  ipcMain: ElectronTerminalIpcMain;
  terminalService: TerminalService;
};

const readElectronTerminalSendRequest = (request: unknown): ElectronTerminalSendRequest => {
  const parsedRequest = electronTerminalSendRequestSchema.safeParse(request);
  if (parsedRequest.success) return parsedRequest.data;
  throw new ElectronValidationError({
    operation: "electron.terminal.request",
    field: "request",
    message: "Electron terminal send requests must contain a client ID and protocol frame.",
    details: { issues: jsonIssues(parsedRequest.error.issues) },
  });
};

const readClientId = (clientId: unknown): Effect.Effect<string, ElectronValidationError> => {
  const parsedClientId = electronTerminalClientIdSchema.safeParse(clientId);
  return parsedClientId.success
    ? Effect.succeed(parsedClientId.data)
    : Effect.fail(
        new ElectronValidationError({
          operation: "electron.terminal.client",
          field: "clientId",
          message: "Electron terminal client IDs must contain between 1 and 128 characters.",
        }),
      );
};

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
    rawClientId: string,
    rawFrame: unknown,
  ): Effect.Effect<void, ElectronValidationError> => {
    const parsedFrame = electronTerminalFrameSchema.safeParse(rawFrame);
    if (!parsedFrame.success) {
      return Effect.fail(
        new ElectronValidationError({
          operation: "electron.terminal.decode",
          field: "frame",
          message: "Electron terminal frames must be Uint8Array values.",
        }),
      );
    }
    return Effect.gen(function* () {
      const clientId = yield* readClientId(rawClientId);
      const frame = yield* Effect.try({
        try: () => decodeTerminalProtocolFrame(parsedFrame.data),
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
  };
  const detachClient = (
    senderId: number,
    rawClientId: string,
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

export const registerElectronTerminalIpc = ({
  ipcMain,
  terminalService,
}: RegisterElectronTerminalIpcInput): void => {
  const terminalIpc = createElectronTerminalIpcController(terminalService);
  const boundTerminalSenders = new WeakSet<ElectronTerminalLifecycleSender>();
  const bindTerminalSenderCleanup = (sender: ElectronTerminalLifecycleSender): void => {
    if (boundTerminalSenders.has(sender)) return;
    boundTerminalSenders.add(sender);
    const detach = () => {
      void runElectronEffect(terminalIpc.detachSender(sender.id));
    };
    sender.once("destroyed", detach);
    sender.on("did-start-navigation", (details) => {
      if (shouldDetachTerminalSenderForNavigation(details)) detach();
    });
  };

  ipcMain.handle(ELECTRON_TERMINAL_SEND_CHANNEL, async (event, request) => {
    bindTerminalSenderCleanup(event.sender);
    const parsedRequest = readElectronTerminalSendRequest(request);
    await runElectronEffect(
      terminalIpc.handleFrame(event.sender, parsedRequest.clientId, parsedRequest.frame),
    );
  });

  ipcMain.handle(ELECTRON_TERMINAL_DISCONNECT_CHANNEL, async (event, clientId) => {
    bindTerminalSenderCleanup(event.sender);
    const parsedClientId = await runElectronEffect(readClientId(clientId));
    await runElectronEffect(terminalIpc.detachClient(event.sender.id, parsedClientId));
  });
};

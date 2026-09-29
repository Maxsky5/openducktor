import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  isTerminalClientMessage,
  withMaxUtf16Length,
} from "@openducktor/contracts";
import {
  createTerminalClientSession,
  type TerminalClientSession,
  type TerminalService,
  type TerminalServiceError,
} from "@openducktor/host";
import { Effect, Exit } from "effect";
import { runElectronEffect } from "../../effect/electron-boundary";
import {
  causeToElectronBoundaryError,
  ElectronValidationError,
  jsonIssues,
} from "../../effect/electron-errors";
import { runElectronMainTask } from "../electron-main-task-owner";
import {
  ELECTRON_TERMINAL_DISCONNECT_CHANNEL,
  ELECTRON_TERMINAL_EVENT_CHANNEL,
  ELECTRON_TERMINAL_SEND_CHANNEL,
  type ElectronTerminalEventEnvelope,
} from "../../shared/electron-bridge-contract";
import { z } from "zod";
import type { IpcMain } from "electron";

const MAX_CLIENT_ID_LENGTH = 128;

const electronTerminalClientIdSchema = withMaxUtf16Length(z.string().min(1), MAX_CLIENT_ID_LENGTH);
const electronTerminalFrameSchema = z.instanceof(Uint8Array);
const electronTerminalSendRequestSchema = z.strictObject({
  clientId: electronTerminalClientIdSchema,
  frame: electronTerminalFrameSchema,
});
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

type ElectronTerminalSenderState = {
  sender: ElectronTerminalSender | null;
  clients: Map<string, TerminalClientSession>;
};

type ElectronTerminalLifecycleSender = ElectronTerminalSender & {
  on(
    event: "did-start-navigation",
    listener: (details: ElectronTerminalNavigationDetails) => void,
  ): void;
  once(event: "destroyed", listener: () => void): void;
};

export type ElectronTerminalIpcHandler = Parameters<IpcMain["handle"]>[1];

type ElectronTerminalIpcMain = {
  handle(
    channel: typeof ELECTRON_TERMINAL_SEND_CHANNEL | typeof ELECTRON_TERMINAL_DISCONNECT_CHANNEL,
    listener: ElectronTerminalIpcHandler,
  ): void;
};

type RegisterElectronTerminalIpcInput = {
  ipcMain: ElectronTerminalIpcMain;
  reportLifecycleFailure(senderId: number, cause: unknown): void;
  terminalService: TerminalService;
};

const readElectronTerminalSendRequest = (
  parsedRequest: z.ZodSafeParseResult<ElectronTerminalSendRequest>,
): ElectronTerminalSendRequest => {
  if (parsedRequest.success) return parsedRequest.data;
  throw new ElectronValidationError({
    operation: "electron.terminal.request",
    field: "request",
    message: "Electron terminal send requests must contain a client ID and protocol frame.",
    details: { issues: jsonIssues(parsedRequest.error.issues) },
  });
};

const readClientId = (
  parsedClientId: z.ZodSafeParseResult<string>,
): Effect.Effect<string, ElectronValidationError> => {
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
  const sendersById = new Map<number, ElectronTerminalSenderState>();
  const getClient = (sender: ElectronTerminalSender, clientId: string): TerminalClientSession => {
    const state = sendersById.get(sender.id) ?? {
      sender,
      clients: new Map<string, TerminalClientSession>(),
    };
    const existing = state.clients.get(clientId);
    if (existing) return existing;
    const client = createTerminalClientSession({
      clientId: `electron:${sender.id}:${clientId}`,
      terminalService,
      send: (message, payload) => {
        const activeSender = state.sender;
        if (!activeSender || activeSender.isDestroyed()) return;
        activeSender.send(ELECTRON_TERMINAL_EVENT_CHANNEL, {
          clientId,
          frame: encodeTerminalProtocolFrame({ message, payload }),
        });
      },
    });
    state.clients.set(clientId, client);
    sendersById.set(sender.id, state);
    return client;
  };
  const releaseSender = (senderId: number): void => {
    const state = sendersById.get(senderId);
    if (state) state.sender = null;
  };
  const handleFrame = (
    sender: ElectronTerminalSender,
    clientId: string,
    frame: Uint8Array,
  ): Effect.Effect<void, ElectronValidationError> => {
    return Effect.gen(function* () {
      const decoded = yield* Effect.try({
        try: () => decodeTerminalProtocolFrame(frame),
        catch: (cause) =>
          new ElectronValidationError({
            operation: "electron.terminal.decode",
            field: "frame",
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      if (!isTerminalClientMessage(decoded.message)) {
        return yield* Effect.fail(
          new ElectronValidationError({
            operation: "electron.terminal.direction",
            field: "type",
            message: "Renderer terminal traffic must use a client message type.",
          }),
        );
      }
      yield* getClient(sender, clientId).handle(decoded.message, decoded.payload);
    });
  };
  const detachClient = (
    senderId: number,
    clientId: string,
  ): Effect.Effect<void, TerminalServiceError> =>
    Effect.gen(function* () {
      const state = sendersById.get(senderId);
      if (!state) return;
      const client = state.clients.get(clientId);
      if (!client) return;
      yield* client.close();
      if (state.clients.get(clientId) === client) state.clients.delete(clientId);
      if (state.clients.size === 0 && sendersById.get(senderId) === state) {
        sendersById.delete(senderId);
      }
    });
  const detachSender = (senderId: number): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const state = sendersById.get(senderId);
      if (!state) return;
      const failures: { clientId: string; cause: Error }[] = [];
      for (const [clientId, client] of Array.from(state.clients)) {
        const result = yield* Effect.exit(client.close());
        if (Exit.isFailure(result)) {
          failures.push({ clientId, cause: causeToElectronBoundaryError(result.cause) });
        } else if (state.clients.get(clientId) === client) {
          state.clients.delete(clientId);
        }
      }
      if (state.clients.size === 0 && sendersById.get(senderId) === state) {
        sendersById.delete(senderId);
      }
      if (failures.length === 1) return yield* Effect.fail(failures[0]!.cause);
      if (failures.length > 1) {
        const details = failures.map(({ clientId, cause }) => `${clientId}: ${cause.message}`);
        return yield* Effect.fail(
          new AggregateError(
            failures.map(({ cause }) => cause),
            `Failed to detach ${failures.length} terminal clients: ${details.join("; ")}`,
          ),
        );
      }
    });

  return { detachClient, detachSender, handleFrame, releaseSender };
};

export const registerElectronTerminalIpc = ({
  ipcMain,
  reportLifecycleFailure,
  terminalService,
}: RegisterElectronTerminalIpcInput): void => {
  const terminalIpc = createElectronTerminalIpcController(terminalService);
  const boundTerminalSenders = new WeakSet<ElectronTerminalLifecycleSender>();
  const bindTerminalSenderCleanup = (sender: ElectronTerminalLifecycleSender): void => {
    if (boundTerminalSenders.has(sender)) return;
    boundTerminalSenders.add(sender);
    const senderId = sender.id;
    const detach = () => {
      runElectronMainTask(
        () => runElectronEffect(terminalIpc.detachSender(senderId)),
        (cause) => reportLifecycleFailure(senderId, cause),
      );
    };
    sender.once("destroyed", () => {
      terminalIpc.releaseSender(senderId);
      detach();
    });
    sender.on("did-start-navigation", (details) => {
      if (shouldDetachTerminalSenderForNavigation(details)) detach();
    });
  };

  ipcMain.handle(ELECTRON_TERMINAL_SEND_CHANNEL, async (event, request) => {
    bindTerminalSenderCleanup(event.sender);
    const parsedRequest = readElectronTerminalSendRequest(
      electronTerminalSendRequestSchema.safeParse(request),
    );
    await runElectronEffect(
      terminalIpc.handleFrame(event.sender, parsedRequest.clientId, parsedRequest.frame),
    );
  });

  ipcMain.handle(ELECTRON_TERMINAL_DISCONNECT_CHANNEL, async (event, clientId) => {
    bindTerminalSenderCleanup(event.sender);
    const parsedClientId = await runElectronEffect(
      readClientId(electronTerminalClientIdSchema.safeParse(clientId)),
    );
    await runElectronEffect(terminalIpc.detachClient(event.sender.id, parsedClientId));
  });
};

import {
  type BrowserServerMessage,
  decodeBrowserClientMessage,
  encodeBrowserChannelMessage,
} from "@openducktor/contracts";
import type { BrowserClientSession, BrowserEngineError, BrowserService } from "@openducktor/host";
import { Effect } from "effect";
import type { IpcMain } from "electron";
import type { z } from "zod";
import { runElectronEffect } from "../../effect/electron-boundary";
import { ElectronValidationError, jsonIssues } from "../../effect/electron-errors";
import {
  ELECTRON_BROWSER_BIND_GUEST_CHANNEL,
  ELECTRON_BROWSER_CONNECT_CHANNEL,
  ELECTRON_BROWSER_DISCONNECT_CHANNEL,
  ELECTRON_BROWSER_EVENT_CHANNEL,
  ELECTRON_BROWSER_PICK_FILES_CHANNEL,
  ELECTRON_BROWSER_SEND_CHANNEL,
  type ElectronBrowserEventEnvelope,
  type ElectronBrowserPickFilesRequest,
  electronBrowserBindGuestRequestSchema,
  electronBrowserClientIdSchema,
  electronBrowserPickFilesRequestSchema,
  electronBrowserSendRequestSchema,
} from "../../shared/electron-bridge-contract";
import {
  createRendererClientCleanup,
  type ElectronRendererLifecycle,
} from "../electron-renderer-client-cleanup";

export type ElectronBrowserSender = {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, envelope: ElectronBrowserEventEnvelope): void;
};

type ElectronBrowserLifecycleSender = ElectronBrowserSender & ElectronRendererLifecycle;

type SenderState = {
  readonly sender: ElectronBrowserSender;
  readonly clients: Map<string, BrowserClientSession>;
};

export type ElectronBrowserIpcControllerInput = {
  browserService: Pick<BrowserService, "connectClient">;
  reportDeliveryFailure(senderId: number, cause: unknown): void;
};

/**
 * The browser channel clients of each OpenDucktor renderer. Each client gets its own host browser
 * client session. Engine messages, such as shortcuts, go to every client of one renderer.
 */
export const createElectronBrowserIpcController = (input: ElectronBrowserIpcControllerInput) => {
  const senders = new Map<number, SenderState>();

  const deliver = (
    sender: ElectronBrowserSender,
    clientId: string,
    message: BrowserServerMessage,
  ): void => {
    if (sender.isDestroyed()) {
      return;
    }
    try {
      sender.send(ELECTRON_BROWSER_EVENT_CHANNEL, {
        clientId,
        frame: encodeBrowserChannelMessage(message),
      });
    } catch (cause) {
      input.reportDeliveryFailure(sender.id, cause);
    }
  };

  const connect = (sender: ElectronBrowserSender, clientId: string): void => {
    let state = senders.get(sender.id);
    if (!state) {
      state = { sender, clients: new Map() };
      senders.set(sender.id, state);
    }
    if (state.clients.has(clientId)) {
      return;
    }
    state.clients.set(
      clientId,
      input.browserService.connectClient({
        clientId: `electron:${sender.id}:${clientId}`,
        send: (message) => deliver(sender, clientId, message),
      }),
    );
  };

  const handleFrame = (
    sender: ElectronBrowserSender,
    clientId: string,
    frame: Uint8Array,
  ): Effect.Effect<void, ElectronValidationError> =>
    Effect.gen(function* () {
      const client = senders.get(sender.id)?.clients.get(clientId);
      if (!client) {
        return yield* new ElectronValidationError({
          operation: "electron.browser.send",
          field: "clientId",
          message: "This browser channel client is not connected. Connect it before you send.",
        });
      }
      const decoded = yield* Effect.try({
        try: () => decodeBrowserClientMessage(frame),
        catch: (cause) =>
          new ElectronValidationError({
            operation: "electron.browser.decode",
            field: "frame",
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      yield* client.handle(decoded);
    });

  const detachClient = (senderId: number, clientId: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const state = senders.get(senderId);
      const client = state?.clients.get(clientId);
      if (!state || !client) {
        return Effect.void;
      }
      state.clients.delete(clientId);
      if (state.clients.size === 0) {
        senders.delete(senderId);
      }
      return client.close();
    });

  const detachSender = (senderId: number): Effect.Effect<void> =>
    Effect.suspend(() => {
      const state = senders.get(senderId);
      if (!state) {
        return Effect.void;
      }
      senders.delete(senderId);
      const clients = Array.from(state.clients.values());
      state.clients.clear();
      return Effect.forEach(clients, (client) => client.close(), { discard: true });
    });

  return {
    connect,
    handleFrame,
    detachClient,
    detachSender,
    /** Sends an engine message to every browser client of one renderer. */
    sendToRenderer: (senderId: number, message: BrowserServerMessage): void => {
      const state = senders.get(senderId);
      if (!state) {
        return;
      }
      for (const clientId of state.clients.keys()) {
        deliver(state.sender, clientId, message);
      }
    },
  };
};

export type ElectronBrowserIpcController = ReturnType<typeof createElectronBrowserIpcController>;

export type ElectronBrowserIpcHandler = Parameters<IpcMain["handle"]>[1];

type ElectronBrowserIpcMain = {
  handle(channel: string, listener: ElectronBrowserIpcHandler): void;
};

export type RegisterElectronBrowserIpcInput = {
  ipcMain: ElectronBrowserIpcMain;
  controller: ElectronBrowserIpcController;
  engine: {
    isMainWindow(webContentsId: number): boolean;
    setMainWindowLoaded(webContentsId: number, loaded: boolean): void;
    bindGuest(
      senderId: number,
      tabId: string,
      webContentsId: number,
    ): Effect.Effect<void, BrowserEngineError>;
  };
  /** Opens the OS file dialog over the window of the sender. An empty list means cancel. */
  pickFiles(senderId: number, request: ElectronBrowserPickFilesRequest): Promise<string[]>;
  reportLifecycleFailure(senderId: number, cause: unknown): void;
};

const parseIpcInput = <Output>(
  operation: string,
  field: string,
  message: string,
  parsed: z.ZodSafeParseResult<Output>,
): Output => {
  if (parsed.success) {
    return parsed.data;
  }
  throw new ElectronValidationError({
    operation,
    field,
    message,
    details: { issues: jsonIssues(parsed.error.issues) },
  });
};

/** Registers the browser IPC of the OpenDucktor windows. Other senders get a validation error. */
export const registerElectronBrowserIpc = ({
  ipcMain,
  controller,
  engine,
  pickFiles,
  reportLifecycleFailure,
}: RegisterElectronBrowserIpcInput): void => {
  const bindSenderCleanup = createRendererClientCleanup({
    detachSender: controller.detachSender,
    reportFailure: reportLifecycleFailure,
  });
  const requireMainWindow = (sender: ElectronBrowserLifecycleSender, operation: string): void => {
    if (!engine.isMainWindow(sender.id)) {
      throw new ElectronValidationError({
        operation,
        field: "sender",
        message: "Only an OpenDucktor window can use browser tabs.",
      });
    }
    bindSenderCleanup(sender);
  };
  const readClientId = (operation: string, parsed: z.ZodSafeParseResult<string>) =>
    parseIpcInput(
      operation,
      "clientId",
      "Browser channel client IDs must contain between 1 and 128 characters.",
      parsed,
    );

  // The renderer connects its channel once it runs. Electron does not always send
  // `did-finish-load` after a renderer reload, so the window counts as ready from this moment.
  ipcMain.handle(ELECTRON_BROWSER_CONNECT_CHANNEL, async (event, clientId) => {
    requireMainWindow(event.sender, "electron.browser.connect");
    controller.connect(
      event.sender,
      readClientId("electron.browser.connect", electronBrowserClientIdSchema.safeParse(clientId)),
    );
    engine.setMainWindowLoaded(event.sender.id, true);
  });

  ipcMain.handle(ELECTRON_BROWSER_SEND_CHANNEL, async (event, request) => {
    requireMainWindow(event.sender, "electron.browser.send");
    const parsed = parseIpcInput(
      "electron.browser.send",
      "request",
      "Browser channel send requests must contain a client ID and a channel frame.",
      electronBrowserSendRequestSchema.safeParse(request),
    );
    await runElectronEffect(controller.handleFrame(event.sender, parsed.clientId, parsed.frame));
  });

  ipcMain.handle(ELECTRON_BROWSER_DISCONNECT_CHANNEL, async (event, clientId) => {
    requireMainWindow(event.sender, "electron.browser.disconnect");
    await Effect.runPromise(
      controller.detachClient(
        event.sender.id,
        readClientId(
          "electron.browser.disconnect",
          electronBrowserClientIdSchema.safeParse(clientId),
        ),
      ),
    );
  });

  ipcMain.handle(ELECTRON_BROWSER_BIND_GUEST_CHANNEL, async (event, request) => {
    requireMainWindow(event.sender, "electron.browser.bind_guest");
    const parsed = parseIpcInput(
      "electron.browser.bind_guest",
      "request",
      "Bind requests must contain a browser tab ID and a webview webContents ID.",
      electronBrowserBindGuestRequestSchema.safeParse(request),
    );
    await runElectronEffect(engine.bindGuest(event.sender.id, parsed.tabId, parsed.webContentsId));
  });

  ipcMain.handle(ELECTRON_BROWSER_PICK_FILES_CHANNEL, async (event, request) => {
    requireMainWindow(event.sender, "electron.browser.pick_files");
    return pickFiles(
      event.sender.id,
      parseIpcInput(
        "electron.browser.pick_files",
        "request",
        "File dialog requests must contain multiple and accept values.",
        electronBrowserPickFilesRequestSchema.safeParse(request),
      ),
    );
  });
};

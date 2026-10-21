import { describe, expect, test } from "bun:test";
import {
  type BrowserClientMessage,
  type BrowserServerMessage,
  decodeBrowserServerMessage,
  encodeBrowserChannelMessage,
} from "@openducktor/contracts";
import type { BrowserClientSessionInput } from "@openducktor/host";
import { BrowserEngineError } from "@openducktor/host";
import { Effect } from "effect";
import type { JSONType } from "zod";
import type { ElectronBrowserEventEnvelope } from "../../shared/electron-bridge-contract";
import {
  createElectronBrowserIpcController,
  type ElectronBrowserIpcHandler,
  registerElectronBrowserIpc,
} from "./electron-browser-ipc";

const TAB_ID = "11111111-1111-4111-8111-111111111111";

const createService = () => {
  const handled: Array<{ clientId: string; message: BrowserClientMessage }> = [];
  const closed: string[] = [];
  const sessions = new Map<string, BrowserClientSessionInput>();
  return {
    handled,
    closed,
    sessions,
    browserService: {
      connectClient: (input: BrowserClientSessionInput) => {
        sessions.set(input.clientId, input);
        return {
          handle: (message: BrowserClientMessage) =>
            Effect.sync(() => {
              handled.push({ clientId: input.clientId, message });
            }),
          close: () => Effect.sync(() => closed.push(input.clientId)),
        };
      },
    },
  };
};

const createSender = (id = 7) => {
  const sent: ElectronBrowserEventEnvelope[] = [];
  const listeners = new Map<string, Array<() => void>>();
  return {
    sent,
    listeners,
    sender: {
      id,
      isDestroyed: () => false,
      send: (_channel: string, envelope: ElectronBrowserEventEnvelope) => sent.push(envelope),
      on: (event: string, listener: () => void) =>
        listeners.set(event, [...(listeners.get(event) ?? []), listener]),
      once: (event: string, listener: () => void) =>
        listeners.set(event, [...(listeners.get(event) ?? []), () => listener()]),
    },
  };
};

const hover: BrowserClientMessage = { type: "picker_hover", tabId: TAB_ID, x: 1, y: 2 };

describe("Electron browser IPC controller", () => {
  test("connects one host client for each renderer client and routes frames", async () => {
    const service = createService();
    const controller = createElectronBrowserIpcController({
      browserService: service.browserService,
      reportDeliveryFailure: () => {},
    });
    const { sender, sent } = createSender();
    controller.connect(sender, "client-a");
    controller.connect(sender, "client-a");
    await Effect.runPromise(
      controller.handleFrame(sender, "client-a", encodeBrowserChannelMessage(hover)),
    );

    expect([...service.sessions.keys()]).toEqual(["electron:7:client-a"]);
    expect(service.handled).toEqual([{ clientId: "electron:7:client-a", message: hover }]);

    const reply: BrowserServerMessage = {
      type: "picker_target",
      tabId: TAB_ID,
      x: 1,
      y: 2,
      target: null,
    };
    service.sessions.get("electron:7:client-a")?.send(reply, new Uint8Array(0));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.clientId).toBe("client-a");
    expect(decodeBrowserServerMessage(sent[0]?.frame ?? new Uint8Array())).toEqual(reply);
  });

  test("rejects frames of unconnected clients and bad frames", async () => {
    const service = createService();
    const controller = createElectronBrowserIpcController({
      browserService: service.browserService,
      reportDeliveryFailure: () => {},
    });
    const { sender } = createSender();
    const unconnected = await Effect.runPromiseExit(
      controller.handleFrame(sender, "client-a", encodeBrowserChannelMessage(hover)),
    );
    expect(JSON.stringify(unconnected)).toContain("not connected");
    controller.connect(sender, "client-a");
    const bad = await Effect.runPromiseExit(
      controller.handleFrame(sender, "client-a", new Uint8Array([0, 0, 0, 2, 123, 125])),
    );
    expect(JSON.stringify(bad)).toContain("electron.browser.decode");
  });

  test("sends engine messages to every client of a renderer and closes clients on detach", async () => {
    const service = createService();
    const controller = createElectronBrowserIpcController({
      browserService: service.browserService,
      reportDeliveryFailure: () => {},
    });
    const { sender, sent } = createSender();
    controller.connect(sender, "client-a");
    controller.connect(sender, "client-b");
    controller.sendToRenderer(7, { type: "shortcut", shortcut: "command_palette" });
    controller.sendToRenderer(8, { type: "shortcut", shortcut: "command_palette" });
    expect(sent.map((envelope) => envelope.clientId)).toEqual(["client-a", "client-b"]);

    await Effect.runPromise(controller.detachClient(7, "client-a"));
    await Effect.runPromise(controller.detachSender(7));
    expect(service.closed).toEqual(["electron:7:client-a", "electron:7:client-b"]);
  });
});

describe("registerElectronBrowserIpc", () => {
  const register = (isMainWindow: (id: number) => boolean) => {
    const handlers = new Map<string, ElectronBrowserIpcHandler>();
    const binds: Array<[number, string, number]> = [];
    const picks: Array<[number, { multiple: boolean; accept: string[] }]> = [];
    const loaded: Array<[number, boolean]> = [];
    const service = createService();
    registerElectronBrowserIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      controller: createElectronBrowserIpcController({
        browserService: service.browserService,
        reportDeliveryFailure: () => {},
      }),
      engine: {
        isMainWindow,
        setMainWindowLoaded: (id, value) => loaded.push([id, value]),
        bindGuest: (senderId, tabId, webContentsId) =>
          webContentsId === 13
            ? Effect.fail(
                new BrowserEngineError({
                  code: "operation_failed",
                  operation: "test",
                  message: "The webview belongs to another window.",
                }),
              )
            : Effect.sync(() => {
                binds.push([senderId, tabId, webContentsId]);
              }),
      },
      pickFiles: async (senderId, request) => {
        picks.push([senderId, request]);
        return ["/tmp/a.png"];
      },
      reportLifecycleFailure: () => {},
    });
    const invoke = (
      channel: string,
      sender: ReturnType<typeof createSender>["sender"],
      arg: JSONType,
    ) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing handler for ${channel}.`);
      // SAFETY: The handler reads only `sender` from the Electron invoke event.
      return handler({ sender } as Parameters<ElectronBrowserIpcHandler>[0], arg);
    };
    return { invoke, channels: [...handlers.keys()], binds, picks, service, loaded };
  };

  test("refuses every browser channel to a sender that is not an OpenDucktor window", async () => {
    const { invoke, channels, binds, picks, loaded, service } = register(() => false);
    const { sender } = createSender();

    expect(channels).not.toHaveLength(0);
    for (const channel of channels) {
      await expect(invoke(channel, sender, "client-a")).rejects.toMatchObject({
        _tag: "ElectronValidationError",
        field: "sender",
      });
    }
    expect([binds, picks, loaded, service.handled]).toEqual([[], [], [], []]);
  });

  test("a window can show tabs once its renderer connects the browser channel", async () => {
    const { invoke, loaded } = register(() => true);
    const { sender } = createSender();

    await invoke("openducktor:browser:connect", sender, "client-a");

    expect(loaded).toEqual([[sender.id, true]]);
  });

  test("validates and forwards guest binds and file dialogs", async () => {
    const { invoke, binds, picks } = register(() => true);
    const { sender } = createSender();
    await invoke("openducktor:browser:bind-guest", sender, { tabId: TAB_ID, webContentsId: 12 });
    await expect(
      invoke("openducktor:browser:bind-guest", sender, { tabId: "x", webContentsId: 12 }),
    ).rejects.toMatchObject({ field: "request" });
    await expect(
      invoke("openducktor:browser:bind-guest", sender, { tabId: TAB_ID, webContentsId: 13 }),
    ).rejects.toMatchObject({ message: "The webview belongs to another window." });
    expect(
      await invoke("openducktor:browser:pick-files", sender, { multiple: true, accept: [".png"] }),
    ).toEqual(["/tmp/a.png"]);
    await expect(
      invoke("openducktor:browser:pick-files", sender, { multiple: "yes" }),
    ).rejects.toMatchObject({
      field: "request",
    });
    expect(binds).toEqual([[7, TAB_ID, 12]]);
    expect(picks).toEqual([[7, { multiple: true, accept: [".png"] }]]);
  });

  test("closes the clients of a renderer that navigates away", async () => {
    const { invoke, service } = register(() => true);
    const renderer = createSender();
    await invoke("openducktor:browser:connect", renderer.sender, "client-a");
    for (const listener of renderer.listeners.get("did-navigate") ?? []) listener();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.closed).toEqual(["electron:7:client-a"]);
  });
});

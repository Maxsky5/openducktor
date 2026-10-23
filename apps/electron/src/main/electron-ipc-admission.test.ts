import { expect, mock, test } from "bun:test";
import type { IpcMain, IpcMainInvokeEvent, WebFrameMain, WebContents } from "electron";
import { createMainWindowIpcRegistrar } from "./electron-ipc-admission";
import { registerElectronEditorClipboardIpc } from "./electron-editor-clipboard-ipc";

test("privileged clipboard reads require the registered live window's current main frame", async () => {
  const handlers = new Map<string, Parameters<IpcMain["handle"]>[1]>();
  let registered = true;
  let destroyed = false;
  // SAFETY: admission only reads the frame identity and destroyed state supplied by this fake.
  const frame = { processId: 3, routingId: 5, isDestroyed: () => destroyed } as WebFrameMain;
  // SAFETY: the clipboard handler reads no WebContents fields beyond this admission contract.
  const sender = { mainFrame: frame, isDestroyed: () => destroyed } as WebContents;
  // SAFETY: all event fields used by the admission gate are present.
  const event = { sender, senderFrame: frame, processId: 3, frameId: 5 } as IpcMainInvokeEvent;
  const readText = mock(async () => "clipboard text");
  const ipcMain = createMainWindowIpcRegistrar(
    {
      handle: (name, handler) => {
        handlers.set(name, handler);
      },
    },
    (candidate) => registered && candidate === sender,
  );
  registerElectronEditorClipboardIpc({ ipcMain, clipboard: { readText, read: async () => [] } });
  const invoke = handlers.get("openducktor:editor-clipboard:read")!;
  expect(await invoke(event)).toBe("clipboard text");
  expect(readText).toHaveBeenCalledTimes(1);
  for (const senderFrame of [null, { ...frame, routingId: 6 }, { ...frame }]) {
    // SAFETY: each deliberately invalid event reaches only the admission gate.
    expect(() => invoke({ ...event, senderFrame } as IpcMainInvokeEvent)).toThrow(
      "active OpenDucktor main window",
    );
  }
  registered = false;
  expect(() => invoke(event)).toThrow("active OpenDucktor main window");
  registered = true;
  destroyed = true;
  expect(() => invoke(event)).toThrow("active OpenDucktor main window");
  expect(readText).toHaveBeenCalledTimes(1);
});

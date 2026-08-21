import { describe, expect, mock, test } from "bun:test";
import type { IpcMainInvokeEvent } from "electron";
import {
  ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL,
  PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE,
} from "../shared/electron-bridge-contract";
import { registerElectronEditorClipboardIpc } from "./electron-editor-clipboard-ipc";

// SAFETY: these tests only exercise renderer payload handling; handlers never read the event.
const ipcMainInvokeEvent = {} as IpcMainInvokeEvent;

describe("Electron editor clipboard IPC", () => {
  test("reads plain text and Pierre multi-selection data in the main process", async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, type?: string) => string>();
    const read = mock((format: string) => `typed:${format}`);
    const readText = mock(() => "plain");
    registerElectronEditorClipboardIpc({
      clipboard: { read, readText },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    });
    const handler = handlers.get(ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL);

    expect(handler).toBeFunction();
    expect(await handler?.(ipcMainInvokeEvent)).toBe("plain");
    expect(await handler?.(ipcMainInvokeEvent, PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE)).toBe(
      `typed:${PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE}`,
    );
  });

  test("rejects any other renderer-supplied format", () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, type?: string) => string>();
    const read = mock(() => "not read");
    registerElectronEditorClipboardIpc({
      clipboard: { read, readText: mock(() => "plain") },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    });

    expect(() =>
      handlers.get(ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL)?.(ipcMainInvokeEvent, "text/html"),
    ).toThrow("Unsupported editor clipboard format.");
    expect(read).not.toHaveBeenCalled();
  });
});

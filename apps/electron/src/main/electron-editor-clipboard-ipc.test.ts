import { describe, expect, mock, test } from "bun:test";
import {
  ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL,
  PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE,
} from "../shared/electron-bridge-contract";
import {
  readEditorClipboardText,
  registerElectronEditorClipboardIpc,
} from "./electron-editor-clipboard-ipc";

type ElectronEditorClipboardIpcMain = Parameters<
  typeof registerElectronEditorClipboardIpc
>[0]["ipcMain"];
type ElectronEditorClipboardHandler = Parameters<ElectronEditorClipboardIpcMain["handle"]>[1];

describe("Electron editor clipboard IPC", () => {
  test("reads plain text and Pierre multi-selection data in the main process", () => {
    const handlers = new Map<string, ElectronEditorClipboardHandler>();
    const read = mock((format: string) => `typed:${format}`);
    const readText = mock(() => "plain");
    registerElectronEditorClipboardIpc({
      clipboard: { read, readText },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    });
    const handler = handlers.get(ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL);

    expect(handler).toBeFunction();
    expect(readEditorClipboardText({ read, readText })).toBe("plain");
    expect(readEditorClipboardText({ read, readText }, PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE)).toBe(
      `typed:${PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE}`,
    );
  });

  test("rejects any other renderer-supplied format", () => {
    const read = mock(() => "not read");
    const clipboard = { read, readText: mock(() => "plain") };

    expect(() => readEditorClipboardText(clipboard, "text/html")).toThrow(
      "Unsupported editor clipboard format.",
    );
    expect(read).not.toHaveBeenCalled();
  });
});

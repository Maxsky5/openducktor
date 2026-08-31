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

const PIERRE_MULTI_SELECTION_WEB_CLIPBOARD_TYPE = `web ${PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE}`;
const PIERRE_MULTI_SELECTION_OS_CLIPBOARD_TYPE = `electron application/osclipboard;format="${PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE}"`;

describe("Electron editor clipboard IPC", () => {
  test("reads plain text and Pierre web custom data in the main process", async () => {
    const handlers = new Map<string, ElectronEditorClipboardHandler>();
    const getType = mock(async (format: string) => new Blob([`typed:${format}`]));
    const read = mock(async () => [
      { getType, types: [PIERRE_MULTI_SELECTION_WEB_CLIPBOARD_TYPE] },
    ]);
    const readText = mock(async () => "plain");
    registerElectronEditorClipboardIpc({
      clipboard: { read, readText },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    });
    const handler = handlers.get(ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL);

    expect(handler).toBeFunction();
    expect(await readEditorClipboardText({ read, readText })).toBe("plain");
    expect(
      await readEditorClipboardText({ read, readText }, PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE),
    ).toBe(`typed:${PIERRE_MULTI_SELECTION_WEB_CLIPBOARD_TYPE}`);
    expect(getType).toHaveBeenCalledWith(PIERRE_MULTI_SELECTION_WEB_CLIPBOARD_TYPE);
  });

  test("preserves Electron 43 raw-format precedence", async () => {
    const getType = mock(async (format: string) => new Blob([format]));
    const clipboard = {
      read: mock(async () => [
        {
          getType,
          types: [
            PIERRE_MULTI_SELECTION_WEB_CLIPBOARD_TYPE,
            PIERRE_MULTI_SELECTION_OS_CLIPBOARD_TYPE,
          ],
        },
      ]),
      readText: mock(async () => "plain"),
    };

    expect(await readEditorClipboardText(clipboard, PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE)).toBe(
      PIERRE_MULTI_SELECTION_OS_CLIPBOARD_TYPE,
    );
  });

  test("returns empty text when the Pierre multi-selection format is absent", async () => {
    const clipboard = {
      read: mock(async () => []),
      readText: mock(async () => "plain"),
    };

    expect(await readEditorClipboardText(clipboard, PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE)).toBe(
      "",
    );
  });

  test("rejects any other renderer-supplied format", async () => {
    const read = mock(async () => []);
    const clipboard = { read, readText: mock(async () => "plain") };

    await expect(readEditorClipboardText(clipboard, "text/html")).rejects.toThrow(
      "Unsupported editor clipboard format.",
    );
    expect(read).not.toHaveBeenCalled();
  });
});

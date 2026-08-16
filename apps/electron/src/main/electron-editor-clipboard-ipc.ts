import {
  ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL,
  PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE,
} from "../shared/electron-bridge-contract";

type ElectronEditorClipboardIpcMain = {
  handle(channel: string, listener: (event: unknown, type?: unknown) => string): void;
};

type ElectronEditorClipboard = {
  read(format: string): string;
  readText(): string;
};

type RegisterElectronEditorClipboardIpcInput = {
  clipboard: ElectronEditorClipboard;
  ipcMain: ElectronEditorClipboardIpcMain;
};

export const readEditorClipboardText = (
  clipboard: ElectronEditorClipboard,
  type?: unknown,
): string => {
  if (type === undefined) return clipboard.readText();
  if (type !== PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE) {
    throw new TypeError("Unsupported editor clipboard format.");
  }
  return clipboard.read(type);
};

export const registerElectronEditorClipboardIpc = ({
  clipboard,
  ipcMain,
}: RegisterElectronEditorClipboardIpcInput): void => {
  ipcMain.handle(ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL, (_event, type) =>
    readEditorClipboardText(clipboard, type),
  );
};

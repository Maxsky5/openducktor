import type { ClipboardBookmark, IpcMainInvokeEvent } from "electron";
import {
  ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL,
  PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE,
} from "../shared/electron-bridge-contract";

type ElectronEditorClipboardIpcMain = {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, type?: string) => Promise<string>,
  ): void;
};

type ElectronEditorClipboardItem = {
  readonly types: string[];
  getType(type: string): Promise<Blob | ClipboardBookmark>;
};

type ElectronEditorClipboard = {
  read(): Promise<ElectronEditorClipboardItem[]>;
  readText(): Promise<string>;
};

type RegisterElectronEditorClipboardIpcInput = {
  clipboard: ElectronEditorClipboard;
  ipcMain: ElectronEditorClipboardIpcMain;
};

export const readEditorClipboardText = async (
  clipboard: ElectronEditorClipboard,
  type?: string,
): Promise<string> => {
  if (type === undefined) return clipboard.readText();
  if (type !== PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE) {
    throw new TypeError("Unsupported editor clipboard format.");
  }

  const clipboardItems = await clipboard.read();
  const clipboardItem = clipboardItems.find((item) => item.types.includes(type));
  if (clipboardItem === undefined) return "";

  const payload = await clipboardItem.getType(type);
  if (!(payload instanceof Blob)) {
    throw new TypeError("Editor clipboard format did not contain text data.");
  }
  return payload.text();
};

export const registerElectronEditorClipboardIpc = ({
  clipboard,
  ipcMain,
}: RegisterElectronEditorClipboardIpcInput): void => {
  ipcMain.handle(ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL, (_event, type) =>
    readEditorClipboardText(clipboard, type),
  );
};

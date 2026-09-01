import type { ClipboardBookmark, IpcMainInvokeEvent } from "electron";
import {
  ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL,
  PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE,
} from "../shared/electron-bridge-contract";

const PIERRE_MULTI_SELECTION_CLIPBOARD_FORMATS = [
  `electron application/osclipboard;format="${PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE}"`,
  `web ${PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE}`,
] as const;

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
  for (const format of PIERRE_MULTI_SELECTION_CLIPBOARD_FORMATS) {
    const clipboardItem = clipboardItems.find((item) => item.types.includes(format));
    if (clipboardItem === undefined) continue;

    const payload = await clipboardItem.getType(format);
    if (!(payload instanceof Blob)) {
      throw new TypeError("Editor clipboard format did not contain text data.");
    }
    return payload.text();
  }
  return "";
};

export const registerElectronEditorClipboardIpc = ({
  clipboard,
  ipcMain,
}: RegisterElectronEditorClipboardIpcInput): void => {
  ipcMain.handle(ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL, (_event, type) =>
    readEditorClipboardText(clipboard, type),
  );
};

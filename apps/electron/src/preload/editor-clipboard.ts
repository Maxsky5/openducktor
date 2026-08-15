import {
  type EditorClipboardReadType,
  PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE,
} from "../shared/electron-bridge-contract";

type NativeClipboardReader = {
  read(format: string): string;
  readText(): string;
};

export const readEditorClipboardText = (
  clipboard: NativeClipboardReader,
  type?: EditorClipboardReadType,
): string => {
  if (type === undefined) return clipboard.readText();
  if (type !== PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE) {
    throw new TypeError("Unsupported editor clipboard format.");
  }
  return clipboard.read(type);
};

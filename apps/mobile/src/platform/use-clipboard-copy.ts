import * as Clipboard from "expo-clipboard";
import { useMemo } from "react";
import { Platform } from "react-native";
import { useFeedbackStore } from "@/app-shell/app-services";
import { type CopyNotice, copyWithNotice, systemConfirmsCopy } from "./clipboard-copy";

const SYSTEM_CONFIRMS_COPY = systemConfirmsCopy(
  Platform.OS === "android" ? Platform.Version : null,
);

export type ClipboardCopy = {
  /** Copies a text. Resolves to true when the text is on the clipboard. */
  copyText: (text: string, notice: CopyNotice) => Promise<boolean>;
  /** Copies the image that `readBase64` reads. Resolves to true when it is on the clipboard. */
  copyImage: (readBase64: () => Promise<string>, notice: CopyNotice) => Promise<boolean>;
};

/**
 * The one way to copy to the clipboard. Each copy says its result once: Android 13 and later
 * shows its own preview of the copied content, so the app shows no success toast there.
 */
export const useClipboardCopy = (): ClipboardCopy => {
  const { feedback } = useFeedbackStore();
  return useMemo(() => {
    const options = { feedback, systemConfirms: SYSTEM_CONFIRMS_COPY };
    return {
      copyText: (text, notice) =>
        copyWithNotice(
          async () => {
            await Clipboard.setStringAsync(text);
          },
          notice,
          options,
        ),
      copyImage: (readBase64, notice) =>
        copyWithNotice(async () => Clipboard.setImageAsync(await readBase64()), notice, options),
    };
  }, [feedback]);
};

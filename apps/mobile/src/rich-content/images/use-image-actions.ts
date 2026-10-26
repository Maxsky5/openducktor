import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useState } from "react";
import { useFeedbackStore } from "@/app-shell/app-services";
import { useClipboardCopy } from "@/platform/use-clipboard-copy";

export type ImageAction = "share" | "copy";

/**
 * Share and Copy for an image in a device file. The share sheet also previews and saves the
 * image. The image bytes enter JavaScript only for a copy. `action` names the action that runs.
 */
/** Opens the share sheet for a device file. False when the device cannot share files. */
export const shareDeviceFile = async (
  uri: string,
  title: string,
  mediaType?: string | undefined,
): Promise<boolean> => {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(
    uri,
    mediaType === undefined ? { dialogTitle: title } : { dialogTitle: title, mimeType: mediaType },
  );
  return true;
};

export const useImageActions = () => {
  const { feedback } = useFeedbackStore();
  const { copyImage } = useClipboardCopy();
  const [action, setAction] = useState<ImageAction | null>(null);

  const share = useCallback(
    async (uri: string, alt: string, mediaType?: string | undefined): Promise<void> => {
      setAction("share");
      try {
        if (!(await shareDeviceFile(uri, alt, mediaType))) {
          feedback.show("warning", "Sharing is not available on this device.");
        }
      } catch (cause) {
        feedback.show("error", "The image was not shared.", { description: errorMessage(cause) });
      } finally {
        setAction(null);
      }
    },
    [feedback],
  );

  const copy = useCallback(
    async (uri: string): Promise<void> => {
      setAction("copy");
      await copyImage(() => new File(uri).base64(), {
        copied: "Image copied.",
        failed: "The image was not copied.",
      });
      setAction(null);
    },
    [copyImage],
  );

  return { action, share, copy };
};

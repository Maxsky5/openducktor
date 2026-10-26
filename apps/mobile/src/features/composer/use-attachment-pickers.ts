import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { AgentChatComposerAttachment } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { DeviceFileReference } from "@openducktor/frontend-core/platform/device-file";
import { useCallback, useState } from "react";
import { pickDocuments, pickLibraryImages } from "@/platform/device-files";
import { type AttachmentPickers, intakePickedFiles } from "./composer-attachments";

/**
 * Opens the photo library or the file picker and adds the picked files to a draft. A file that
 * the composer cannot take shows its reason. Picking stays closed while `enabled` is false.
 */
export function useAttachmentPickers({
  pickers,
  enabled,
  onAdd,
}: {
  pickers: AttachmentPickers;
  enabled: boolean;
  onAdd: (attachments: AgentChatComposerAttachment[]) => void;
}) {
  const { feedback } = useClientConnection();
  const [isPicking, setPicking] = useState(false);
  const run = useCallback(
    async (pick: () => Promise<DeviceFileReference[]>): Promise<void> => {
      if (!enabled || isPicking) return;
      setPicking(true);
      try {
        const { attachments, rejected } = intakePickedFiles(await pick());
        onAdd(attachments);
        for (const file of rejected) {
          feedback.show("error", "This file cannot be attached", { description: file.reason });
        }
      } catch (cause) {
        feedback.show("error", "The picker could not open", { description: errorMessage(cause) });
      } finally {
        setPicking(false);
      }
    },
    [enabled, feedback, isPicking, onAdd],
  );
  const { documentTypes } = pickers;
  const pickPhotos = useCallback(() => run(() => pickLibraryImages({ multiple: true })), [run]);
  const pickFiles = useCallback(
    () => run(() => pickDocuments({ types: documentTypes, multiple: true })),
    [documentTypes, run],
  );
  return {
    isPicking,
    canPickPhotos: enabled && pickers.library,
    canPickFiles: enabled && pickers.documentTypes.length > 0,
    pickPhotos,
    pickFiles,
  };
}

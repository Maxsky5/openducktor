import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import type {
  AttachmentStager,
  DeviceFileReference,
} from "@openducktor/frontend-core/platform/device-file";
import type { HostClient } from "@openducktor/host-client";
import { readFileAsBase64 } from "./read-file-as-base64";
import { getShellBridge } from "./shell-bridge";
import type { ResourceData } from "@/types/resource-source";

/** In the browser, every device file reference of a composer attachment is a `File`. */
export const toBrowserFile = (file: DeviceFileReference): File => {
  if (!(file instanceof File)) {
    throw new Error(`Attachment "${file.name}" is not a browser file.`);
  }
  return file;
};

/** Stages files that the user picked in this browser on `host`. */
export const createBrowserAttachmentStager =
  (host: Pick<HostClient, "workspaceStageLocalAttachment">): AttachmentStager =>
  async (deviceFile) => {
    const file = toBrowserFile(deviceFile);
    if (file.size > LOCAL_ATTACHMENT_BYTE_LIMIT) {
      throw new Error("Attachments must total 32 MiB or less.");
    }
    const input: Parameters<HostClient["workspaceStageLocalAttachment"]>[0] = {
      name: file.name,
      base64Data: await readFileAsBase64(file),
    };
    if (file.type.trim().length > 0) {
      input.mime = file.type;
    }
    const staged = await host.workspaceStageLocalAttachment(input);
    return staged.path;
  };

export const resolveLocalAttachmentPreview = async (
  path: string,
  signal: AbortSignal,
): Promise<ResourceData> => {
  signal.throwIfAborted();
  const trimmedPath = path.trim();
  if (trimmedPath.length === 0) {
    throw new Error("Attachment preview is unavailable because the local file path is missing.");
  }
  if (trimmedPath.startsWith("data:")) {
    return { kind: "url", src: trimmedPath };
  }

  return getShellBridge().resolveLocalAttachmentPreview(trimmedPath, signal);
};

import type { AttachmentStager } from "@openducktor/frontend-core/platform/device-file";
import type { HostClient } from "@openducktor/host-client";
import type { RemoteHostConnection } from "@openducktor/frontend-core/recovery/remote-host-connection";
import { File } from "expo-file-system";
import { pickedFileUri } from "./device-files";

type StageLocalAttachmentInput = Parameters<HostClient["workspaceStageLocalAttachment"]>[0];

/** Copies a picked device file to the host and returns the host path of the copy. */
export const createAttachmentStager =
  (remote: RemoteHostConnection): AttachmentStager =>
  async (file) => {
    const uri = pickedFileUri(file);
    if (!uri) {
      throw new Error(`${file.name} is no longer available on this device. Attach the file again.`);
    }
    const base64Data = await new File(uri).base64();
    const input: StageLocalAttachmentInput = {
      name: file.name,
      base64Data,
    };
    if (file.type) input.mime = file.type;
    const staged = await remote.client.workspaceStageLocalAttachment(input);
    return staged.path;
  };

/** Reads a picked image for `task_asset_stage`, which takes the bytes inline. */
export const readPickedFileBase64 = async (
  file: Parameters<AttachmentStager>[0],
): Promise<string> => {
  const uri = pickedFileUri(file);
  if (!uri) {
    throw new Error(`${file.name} is no longer available on this device. Pick the image again.`);
  }
  return new File(uri).base64();
};

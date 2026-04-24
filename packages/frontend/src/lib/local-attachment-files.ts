import { hostClient } from "@/lib/host-client";
import { getShellBridge } from "./shell-bridge";

const bufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

export const stageLocalAttachmentFile = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const staged = await hostClient.workspaceStageLocalAttachment({
    name: file.name,
    ...(file.type.trim().length > 0 ? { mime: file.type } : {}),
    base64Data: bufferToBase64(buffer),
  });
  return staged.path;
};

export const resolveLocalAttachmentPreviewSrc = async (path: string): Promise<string> => {
  const trimmedPath = path.trim();
  if (trimmedPath.length === 0) {
    throw new Error("Attachment preview is unavailable because the local file path is missing.");
  }

  return getShellBridge().resolveLocalAttachmentPreviewSrc(trimmedPath);
};

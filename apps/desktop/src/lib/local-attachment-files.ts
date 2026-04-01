import { getBrowserBackendUrl, isBrowserAppMode } from "@/lib/browser-mode";
import { hostClient } from "@/lib/host-client";
import { isTauriRuntime } from "@/lib/runtime";

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

export const resolveLocalAttachmentPreviewSrc = async (
  path: string,
  mime?: string,
): Promise<string> => {
  if (isBrowserAppMode()) {
    const baseUrl = getBrowserBackendUrl().replace(/\/$/, "");
    const query = new URLSearchParams({ path });
    if (mime?.trim()) {
      query.set("mime", mime);
    }
    return `${baseUrl}/local-attachment-preview?${query.toString()}`;
  }

  if (isTauriRuntime()) {
    const api = await import("@tauri-apps/api/core");
    return api.convertFileSrc(path);
  }

  return path;
};

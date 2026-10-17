import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import { hostClient } from "@/lib/host-client";
import { readFileAsBase64 } from "./read-file-as-base64";
import { getShellBridge } from "./shell-bridge";
import type { ResourceData } from "@/types/resource-source";

export const stageLocalAttachmentFile = async (file: File): Promise<string> => {
  if (file.size > LOCAL_ATTACHMENT_BYTE_LIMIT) {
    throw new Error("Attachments must total 32 MiB or less.");
  }
  const input: Parameters<typeof hostClient.workspaceStageLocalAttachment>[0] = {
    name: file.name,
    base64Data: await readFileAsBase64(file),
  };
  if (file.type.trim().length > 0) {
    input.mime = file.type;
  }
  const staged = await hostClient.workspaceStageLocalAttachment(input);
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

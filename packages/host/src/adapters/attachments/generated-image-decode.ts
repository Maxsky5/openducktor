import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import { decodeStrictBase64 } from "../../domain/strict-base64";
import { HostValidationError } from "../../effect/host-errors";
export const invalidImage = (itemId: string, reason: string) =>
  new HostValidationError({
    field: "image",
    message: `Image '${itemId}' cannot be previewed: ${reason}`,
    details: { itemId, operation: "generated-image.read" },
  });

const decodeFailureReasons = {
  too_large: "output exceeds the 32 MiB preview limit.",
  malformed: "the runtime returned malformed base64 image data.",
  padding: "the runtime returned malformed base64 padding.",
} as const;

export const decodeInlineImage = (base64: string, itemId: string): Buffer => {
  const decoded = decodeStrictBase64(base64, LOCAL_ATTACHMENT_BYTE_LIMIT);
  if (!decoded.ok) throw invalidImage(itemId, decodeFailureReasons[decoded.reason]);
  return decoded.bytes;
};

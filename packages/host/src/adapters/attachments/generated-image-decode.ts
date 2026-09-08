import {
  LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT,
  LOCAL_ATTACHMENT_BYTE_LIMIT,
} from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
export const invalidImage = (itemId: string, reason: string) =>
  new HostValidationError({
    field: "image",
    message: `Image '${itemId}' cannot be previewed: ${reason}`,
    details: { itemId, operation: "generated-image.read" },
  });
const base64Value = (code: number): number => {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
};

/** Buffer.from accepts malformed base64, so check characters and padding before decoding. */
export const decodeInlineImage = (base64: string, itemId: string): Buffer => {
  if (base64.length > LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT)
    throw invalidImage(itemId, "output exceeds the 32 MiB preview limit.");
  if (base64.length === 0 || base64.length % 4 !== 0)
    throw invalidImage(itemId, "the runtime returned malformed base64 image data.");
  let padding = 0;
  if (base64.endsWith("==")) padding = 2;
  else if (base64.endsWith("=")) padding = 1;
  const byteLength = (base64.length / 4) * 3 - padding;
  if (byteLength > LOCAL_ATTACHMENT_BYTE_LIMIT)
    throw invalidImage(itemId, "output exceeds the 32 MiB preview limit.");
  const end = base64.length - padding;
  for (let index = 0; index < end; index++) {
    if (base64Value(base64.charCodeAt(index)) < 0)
      throw invalidImage(itemId, "the runtime returned malformed base64 image data.");
  }
  const tail = base64Value(base64.charCodeAt(end - 1));
  if ((padding === 2 && (tail & 15) !== 0) || (padding === 1 && (tail & 3) !== 0)) {
    throw invalidImage(itemId, "the runtime returned malformed base64 padding.");
  }
  return Buffer.from(base64, "base64");
};

import { HostValidationError } from "../../../effect/host-errors";

export const decodeArtifactInput = (dataBase64: string): Uint8Array => {
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.toString("base64") !== dataBase64) {
    throw new HostValidationError({
      field: "dataBase64",
      message:
        "Artifact content is not canonical base64. Encode the original bytes as base64 and retry.",
    });
  }
  return bytes;
};

export const artifactChunkEnd = (
  content: Uint8Array,
  mediaType: string,
  offset: number,
  maxBytes: number,
  isUtf8: boolean,
): number => {
  const end = Math.min(content.length, offset + maxBytes);
  const type = mediaType.toLowerCase();
  if (!type.startsWith("text/") && type !== "application/json") return end;
  // Keep invalid text readable as bytes. The preview reports the decode error.
  if (!isUtf8) return end;
  if (offset < content.length && continuationByte(content[offset]!)) {
    throw new HostValidationError({
      field: "byteOffset",
      message:
        "The artifact offset is inside a UTF-8 character. Use the nextByteOffset from the previous read.",
    });
  }
  let boundary = end;
  while (boundary < content.length && continuationByte(content[boundary]!)) boundary--;
  return boundary;
};

const continuationByte = (byte: number): boolean => (byte & 0xc0) === 0x80;

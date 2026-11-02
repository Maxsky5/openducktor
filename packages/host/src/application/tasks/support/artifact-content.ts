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

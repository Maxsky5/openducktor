import {
  LOCAL_ATTACHMENT_BYTE_LIMIT,
  LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT,
} from "@openducktor/contracts";
import type { ImageWorkerRequest, ImageWorkerResponse } from "./image-worker-protocol";

self.onmessage = ({ data }: MessageEvent<ImageWorkerRequest>) => {
  try {
    let response: ImageWorkerResponse;
    if (
      data.mime !== "image/png" ||
      !Number.isInteger(data.byteLength) ||
      data.byteLength <= 0 ||
      data.byteLength > LOCAL_ATTACHMENT_BYTE_LIMIT ||
      data.base64.length > LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT
    )
      throw new Error(
        "The generated image response has invalid content. Check the runtime output.",
      );
    let decoded: string;
    try {
      decoded = atob(data.base64);
    } catch {
      throw new Error("The generated image data cannot be decoded. Check the runtime output.");
    }
    if (decoded.length !== data.byteLength)
      throw new Error(
        "The generated image response has invalid content. Check the runtime output.",
      );
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
    response = { kind: "decode", bytes: bytes.buffer };
    self.postMessage(response, { transfer: response.kind === "decode" ? [response.bytes] : [] });
  } catch (cause) {
    self.postMessage({
      kind: "error",
      message:
        cause instanceof Error ? cause.message : "Image preparation failed. Reload this session.",
    } satisfies ImageWorkerResponse);
  }
};

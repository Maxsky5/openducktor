import { createHash, type Hash } from "node:crypto";
import { parentPort } from "node:worker_threads";
import {
  codexImageGenerationPart,
  type CodexImageGenerationPreparation,
} from "@openducktor/adapters-codex-app-server";
import { fileTypeFromBuffer } from "file-type";
import { HostValidationError } from "../../effect/host-errors";
import { decodeInlineImage, invalidImage } from "./generated-image-decode";
import type {
  GeneratedImageWorkerMessage,
  GeneratedImageWorkerRequest,
  GeneratedImageWorkerResponse,
} from "./generated-image-worker-protocol";

let history: { image: CodexImageGenerationPreparation; hash?: Hash } | undefined;

const prepare = async (
  request: GeneratedImageWorkerRequest,
): Promise<GeneratedImageWorkerResponse> => {
  if (request.kind === "history-start") {
    if (history) throw new Error("Image history preparation already started.");
    const { item } = request.image;
    history = { image: request.image };
    if (item.status === "completed" && (item.savedPath !== undefined || request.hasInlineOutput)) {
      history.hash = createHash("sha256").update(
        item.savedPath !== undefined ? "saved_file\0" : "inline\0",
      );
      if (item.savedPath !== undefined) history.hash.update(item.savedPath);
    }
    return { kind: "ack" };
  }
  if (request.kind === "history-chunk") {
    if (!history?.hash) throw new Error("Image history preparation has no active hash.");
    history.hash.update(request.chunk);
    return { kind: "ack" };
  }
  if (request.kind === "history-end") {
    if (!history) throw new Error("Image history preparation has not started.");
    const { image, hash } = history;
    history = undefined;
    return {
      kind: "history",
      part: codexImageGenerationPart(image.item, image.context, hash?.digest("hex")),
    };
  }
  if (history) throw new Error("Image history preparation has not finished.");
  const bytes =
    request.kind === "inline"
      ? decodeInlineImage(request.base64, request.itemId)
      : Buffer.from(request.bytes.buffer, request.bytes.byteOffset, request.bytes.byteLength);
  let detected;
  try {
    detected = await fileTypeFromBuffer(bytes);
  } catch {
    throw invalidImage(
      request.itemId,
      "the runtime returned an incomplete or malformed PNG. Check the runtime output.",
    );
  }
  if (detected?.mime !== "image/png")
    throw invalidImage(
      request.itemId,
      "only PNG image output is supported. Check the runtime output.",
    );
  // The caller already owns inline base64. Return only its validated byte count.
  if (request.kind === "inline") return { kind: "inline", byteLength: bytes.byteLength };
  return {
    kind: "payload",
    payload: { mime: "image/png", byteLength: bytes.byteLength, base64: bytes.toString("base64") },
  };
};

if (!parentPort) throw new Error("The generated image entrypoint must run in a worker thread.");
const port = parentPort;
port.on("message", async ({ id, request }: GeneratedImageWorkerMessage) => {
  try {
    port.postMessage({ id, result: await prepare(request) });
  } catch (cause) {
    if (!(cause instanceof HostValidationError)) throw cause;
    port.postMessage({
      id,
      result: { kind: "invalid", message: cause.message } satisfies GeneratedImageWorkerResponse,
    });
  }
});

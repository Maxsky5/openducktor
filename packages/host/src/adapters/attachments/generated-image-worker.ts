import { parentPort } from "node:worker_threads";
import { codexImageGenerationPart } from "@openducktor/adapters-codex-app-server";
import { fileTypeFromBuffer } from "file-type";
import { HostValidationError } from "../../effect/host-errors";
import { decodeInlineImage, invalidImage } from "./generated-image-decode";
import type {
  GeneratedImageWorkerRequest,
  GeneratedImageWorkerResponse,
} from "./generated-image-worker-protocol";

const prepare = async (
  request: GeneratedImageWorkerRequest,
): Promise<GeneratedImageWorkerResponse> => {
  if (request.kind === "history")
    return {
      kind: "history",
      parts: request.images.map(({ item, context }) => codexImageGenerationPart(item, context)),
    };
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
  return {
    kind: "payload",
    payload: {
      mime: "image/png",
      byteLength: bytes.byteLength,
      base64: request.kind === "inline" ? request.base64 : bytes.toString("base64"),
    },
  };
};

parentPort?.once("message", async (request: GeneratedImageWorkerRequest) => {
  try {
    parentPort?.postMessage(await prepare(request));
  } catch (cause) {
    if (!(cause instanceof HostValidationError)) throw cause;
    parentPort?.postMessage({
      kind: "invalid",
      message: cause.message,
    } satisfies GeneratedImageWorkerResponse);
  }
});

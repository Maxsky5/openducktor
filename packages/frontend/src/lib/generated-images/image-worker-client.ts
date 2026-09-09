import { agentGeneratedImageReadResultSchema } from "@openducktor/contracts";
export { prepareCodexImageGenerations } from "./image-history-worker-client";
import {
  imageWorkerResponseSchema,
  type ImageWorkerRequest,
  type ImageWorkerResponse,
} from "./image-worker-protocol";

const runImageWorker = (
  request: ImageWorkerRequest,
  signal?: AbortSignal,
): Promise<ImageWorkerResponse> => {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./image-worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () =>
      fail(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("Image decoding was cancelled."),
      );
    worker.onmessage = ({ data: raw }: MessageEvent<unknown>) => {
      const parsed = imageWorkerResponseSchema.safeParse(raw);
      if (!parsed.success) {
        fail(new Error("Image preparation returned an invalid result. Reload this session."));
        return;
      }
      const data = parsed.data;
      cleanup();
      if (data.kind === "error") reject(new Error(data.message));
      else if (data.kind !== request.kind)
        reject(new Error("Image preparation returned an invalid result. Reload this session."));
      else resolve(data);
    };
    worker.onerror = () => fail(new Error("The image worker failed. Reload this session."));
    worker.onmessageerror = () =>
      fail(new Error("The image worker response could not be read. Reload this session."));
    signal?.addEventListener("abort", abort, { once: true });
    try {
      worker.postMessage(request);
    } catch (cause) {
      fail(
        cause instanceof Error
          ? cause
          : new Error("The image worker request failed. Reload this session."),
      );
    }
  });
};

const imageDecodePayloadSchema = agentGeneratedImageReadResultSchema.pick({
  base64: true,
  byteLength: true,
  mime: true,
});

export const decodeGeneratedImage = async (
  data: Omit<Extract<ImageWorkerRequest, { kind: "decode" }>, "kind">,
  signal: AbortSignal,
): Promise<ArrayBuffer> => {
  signal.throwIfAborted();
  if (!imageDecodePayloadSchema.safeParse(data).success)
    throw new Error("The generated image response has invalid content. Check the runtime output.");
  const result = await runImageWorker({ kind: "decode", ...data }, signal);
  signal.throwIfAborted();
  if (result.kind !== "decode")
    throw new Error("Image decoding returned an invalid result. Reload this session.");
  if (result.bytes.byteLength !== data.byteLength)
    throw new Error("Image decoding returned an invalid byte count. Reload this session.");
  return result.bytes;
};

import {
  imageHistoryWorkerResponseSchema,
  type ImageHistoryWorkerRequest,
  type ImageHistoryWorkerResponse,
} from "./image-history-worker-protocol";

export const createImageHistoryWorkerChannel = (signal?: AbortSignal) => {
  signal?.throwIfAborted();
  const worker = new Worker(new URL("./image-history-worker.ts", import.meta.url), {
    type: "module",
  });
  let failure: Error | undefined;
  let closed = false;
  let pending:
    | {
        id: number;
        kind: "ack" | "part";
        resolve: (response: ImageHistoryWorkerResponse) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", abort);
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  };
  const fail = (error: Error) => {
    if (closed) return;
    failure = error;
    pending?.reject(error);
    pending = undefined;
    close();
  };
  const abort = () =>
    fail(
      signal?.reason instanceof Error
        ? signal.reason
        : new Error("Image history preparation was cancelled."),
    );
  worker.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (closed) return;
    const parsed = imageHistoryWorkerResponseSchema.safeParse(data);
    if (
      !parsed.success ||
      !pending ||
      parsed.data.id !== pending.id ||
      (parsed.data.kind !== "error" && parsed.data.kind !== pending.kind)
    ) {
      fail(new Error("Image history preparation returned an invalid result. Reload this session."));
      return;
    }
    if (parsed.data.kind === "error") {
      fail(new Error(parsed.data.message));
      return;
    }
    const { resolve } = pending;
    pending = undefined;
    resolve(parsed.data);
  };
  worker.onerror = () => fail(new Error("The image history worker failed. Reload this session."));
  worker.onmessageerror = () =>
    fail(new Error("The image history worker response could not be read. Reload this session."));
  signal?.addEventListener("abort", abort, { once: true });
  return {
    close,
    send: (request: ImageHistoryWorkerRequest): Promise<ImageHistoryWorkerResponse> => {
      if (closed)
        return Promise.reject(failure ?? new Error("The image history worker is closed."));
      return new Promise((resolve, reject) => {
        pending = {
          id: request.id,
          kind: request.kind === "end" ? "part" : "ack",
          resolve,
          reject,
        };
        try {
          worker.postMessage(request, request.kind === "chunk" ? [request.bytes.buffer] : []);
        } catch (cause) {
          fail(
            cause instanceof Error
              ? cause
              : new Error("The image history worker request failed. Reload this session."),
          );
        }
      });
    },
  };
};

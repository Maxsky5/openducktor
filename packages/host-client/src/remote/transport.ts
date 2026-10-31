import type { RemoteFailure } from "@openducktor/contracts";
export type RemoteHttpResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: AsyncIterable<Uint8Array>;
};
export type RemoteTerminalConnection = { send(frame: Uint8Array): Promise<void>; close(): void };
export interface RemoteTransport {
  request(
    method: "GET" | "POST" | "DELETE",
    url: string,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
    body?: string,
  ): Promise<RemoteHttpResponse>;
  openTerminal(
    url: string,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
    onFrame: (frame: Uint8Array) => void,
    onClose: (failure?: RemoteFailure) => void,
  ): Promise<RemoteTerminalConnection>;
}
export class RemoteConnectionError extends Error {
  constructor(readonly failure: RemoteFailure) {
    super(`${failure.message} ${failure.nextAction}`);
    this.name = "RemoteConnectionError";
  }
}
/**
 * This client refused a reply that is larger than its limit. The connection is sound: only the
 * read that got the reply fails, and the same read gets the same reply again. A mutation with such
 * a reply has an unknown outcome instead.
 */
export class RemoteReplyTooLargeError extends RemoteConnectionError {
  constructor(limit: number) {
    super({
      code: "consumer_overflow",
      message: `The host reply is larger than ${Math.round(limit / (1024 * 1024))} MiB, the limit of this app.`,
      nextAction: "Open this item on the host computer.",
    });
    this.name = "RemoteReplyTooLargeError";
  }
}
export const remoteError = (
  code: RemoteFailure["code"],
  message: string,
  nextAction: string,
): RemoteConnectionError => new RemoteConnectionError({ code, message, nextAction });
export async function* abortableBody(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    while (true) {
      signal.throwIfAborted();
      const result = await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        iterator
          .next()
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", abort));
      });
      if (result.done) return;
      yield result.value;
    }
  } finally {
    void iterator.return?.().catch(() => {});
  }
}
export const readBytes = async (
  response: RemoteHttpResponse,
  signal: AbortSignal,
  limit = 32 * 1024 * 1024,
): Promise<Uint8Array<ArrayBuffer>> => {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of abortableBody(response.body, signal)) {
    signal.throwIfAborted();
    size += part.length;
    if (size > limit) throw new RemoteReplyTooLargeError(limit);
    parts.push(part);
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

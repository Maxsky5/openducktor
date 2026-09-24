import { Readable } from "node:stream";

export const nodeReadableStream = (source: Readable): ReadableStream<Uint8Array> => {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
      } else if (next.value instanceof Uint8Array) {
        controller.enqueue(next.value);
      } else {
        throw new TypeError("Node stream returned a non-binary chunk.");
      }
    },
    cancel() {
      source.destroy();
    },
  });
};

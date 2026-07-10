import { describe, expect, test } from "bun:test";
import { readBoundedFileBytes } from "./bounded-file-read";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const createChunkedHandle = (contents: Uint8Array, chunkSize: number, positions: number[]) => ({
  async read(buffer: Uint8Array, offset: number, length: number, position: number) {
    positions.push(position);
    const bytesRead = Math.min(chunkSize, length, Math.max(0, contents.byteLength - position));
    buffer.set(contents.subarray(position, position + bytesRead), offset);
    return { bytesRead };
  },
});

describe("readBoundedFileBytes", () => {
  test("continues partial reads until EOF", async () => {
    const positions: number[] = [];
    const bytes = await readBoundedFileBytes(
      createChunkedHandle(encoder.encode("complete"), 3, positions),
      16,
    );

    expect(decoder.decode(bytes)).toBe("complete");
    expect(positions).toEqual([0, 3, 6, 8]);
  });

  test("stops once the configured byte limit is filled", async () => {
    const positions: number[] = [];
    const bytes = await readBoundedFileBytes(
      createChunkedHandle(encoder.encode("more-than-five"), 2, positions),
      5,
    );

    expect(decoder.decode(bytes)).toBe("more-");
    expect(positions).toEqual([0, 2, 4]);
  });
});

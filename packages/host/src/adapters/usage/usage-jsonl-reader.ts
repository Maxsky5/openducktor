import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createZstdDecompress } from "node:zlib";

/** Where a later read of a growing JSONL file continues. */
export type UsageJsonlResume = { offset: number; digest: string };

/** True for a line that the parser reads. It runs on every line, so it must stay cheap. */
export type UsageLineFilter = (line: Buffer) => boolean;

const DIGEST_BYTES = 256;
const CHUNK_BYTES = 1 << 20;

const digestOf = (bytes: Buffer): string => createHash("sha1").update(bytes).digest("hex");

/** Reads the bytes before `offset`, so a resume can confirm that the file kept its start. */
const readDigest = async (path: string, offset: number): Promise<string> => {
  const handle = await open(path, "r");
  try {
    const length = Math.min(offset, DIGEST_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset - length);
    return digestOf(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
};

/** True when a resume can continue: the file still has the bytes that the last read saw. */
export const canResumeJsonl = async (path: string, resume: UsageJsonlResume): Promise<boolean> =>
  (await readDigest(path, resume.offset)) === resume.digest;

/** Reads only up to the first line feed of a file, also of a compressed rollout. */
export const readFirstJsonlLine = async (
  path: string,
  compressed: boolean,
): Promise<Buffer | null> => {
  const file = createReadStream(path, { highWaterMark: 64 * 1024 });
  const source = compressed ? file.pipe(createZstdDecompress()) : file;
  if (compressed) file.on("error", (cause) => source.destroy(cause));
  const chunks: Buffer[] = [];
  try {
    // SAFETY: A file stream without an encoding and the zstd stream both yield Buffer chunks.
    for await (const chunk of source as AsyncIterable<Buffer>) {
      const end = chunk.indexOf(10);
      if (end >= 0) {
        chunks.push(chunk.subarray(0, end));
        return Buffer.concat(chunks);
      }
      chunks.push(chunk);
    }
    return chunks.length > 0 ? Buffer.concat(chunks) : null;
  } finally {
    file.destroy();
    source.destroy();
  }
};

/**
 * Calls `onLine` with the bytes of each complete line from `offset`, so a parser can skip a line
 * before it decodes it. A last line without a line feed is
 * pending: the result offset stops before it, so a later read parses it once it is complete.
 * Lines that the filter rejects are skipped.
 */
export const readJsonlLines = async (
  path: string,
  input: { offset: number; compressed: boolean; filter: UsageLineFilter },
  onLine: (line: Buffer) => void,
): Promise<UsageJsonlResume | null> => {
  const file = createReadStream(path, {
    start: input.compressed ? 0 : input.offset,
    highWaterMark: CHUNK_BYTES,
  });
  // Large output chunks decode several times faster than the 16 KiB default.
  const source = input.compressed
    ? file.pipe(createZstdDecompress({ chunkSize: CHUNK_BYTES }))
    : file;
  if (input.compressed) file.on("error", (cause) => source.destroy(cause));
  const emit = (line: Buffer) => {
    if (input.filter(line)) onLine(line);
  };
  let carry: Buffer | null = null;
  let consumed = input.offset;
  // SAFETY: A file stream without an encoding and the zstd stream both yield Buffer chunks.
  for await (const chunk of source as AsyncIterable<Buffer>) {
    const data: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    let end = data.indexOf(10, start);
    while (end >= 0) {
      if (end > start) emit(data.subarray(start, end));
      start = end + 1;
      end = data.indexOf(10, start);
    }
    consumed += start;
    carry = start < data.length ? data.subarray(start) : null;
  }
  // A compressed rollout never grows. Its last line is complete without a line feed.
  if (input.compressed) {
    if (carry) emit(carry);
    return null;
  }
  return { offset: consumed, digest: await readDigest(path, consumed) };
};

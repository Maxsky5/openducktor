import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { canResumeJsonl, readJsonlLines } from "./usage-jsonl-reader";

let directory = "";
const all = () => true;

const read = async (file: string, offset = 0, compressed = false) => {
  const lines: string[] = [];
  const resume = await readJsonlLines(file, { offset, compressed, filter: all }, (line) =>
    lines.push(line.toString("utf8")),
  );
  return { lines, resume };
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "odt-usage-jsonl-"));
});

afterEach(async () => {
  await removeTestDirectory(directory);
});

describe("readJsonlLines", () => {
  test("leaves an unterminated last line for a later read", async () => {
    const file = path.join(directory, "session.jsonl");
    await writeFile(file, '{"a":1}\n{"b":');
    const first = await read(file);
    expect(first.lines).toEqual(['{"a":1}']);
    await appendFile(file, '2}\n{"c":3}\n');
    if (!first.resume) throw new Error("Expected a resume point.");
    expect(await canResumeJsonl(file, first.resume)).toBe(true);
    expect((await read(file, first.resume.offset)).lines).toEqual(['{"b":2}', '{"c":3}']);
  });

  test("does not resume a file that another file replaced", async () => {
    const file = path.join(directory, "session.jsonl");
    await writeFile(file, '{"a":1}\n');
    const first = await read(file);
    await writeFile(file, '{"z":9}\n{"y":8}\n');
    if (!first.resume) throw new Error("Expected a resume point.");
    expect(await canResumeJsonl(file, first.resume)).toBe(false);
  });

  test("reads a compressed rollout, with a last line without a line feed", async () => {
    const file = path.join(directory, "rollout.jsonl.zst");
    await writeFile(file, zstdCompressSync(Buffer.from('{"a":1}\n{"b":2}')));
    expect(await read(file, 0, true)).toEqual({ lines: ['{"a":1}', '{"b":2}'], resume: null });
  });

  test("passes only the lines that the filter accepts", async () => {
    const file = path.join(directory, "rollout.jsonl");
    await writeFile(file, '{"type":"keep"}\n{"type":"other","text":"keep"}\n');
    const lines: string[] = [];
    await readJsonlLines(
      file,
      { offset: 0, compressed: false, filter: (line) => line.subarray(0, 15).includes("keep") },
      (line) => lines.push(line.toString("utf8")),
    );
    expect(lines).toEqual(['{"type":"keep"}']);
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { parseUsageSource } from "./usage-source-parser";
import type { UsageParseJob, UsageParseResult } from "./usage-worker-protocol";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "odt-usage-parser-"));
});

afterEach(async () => {
  await removeTestDirectory(directory);
});

/** One Claude Code request line. */
const request = (id: string, timestamp: string) =>
  `${JSON.stringify({
    type: "assistant",
    sessionId: "root",
    timestamp,
    cwd: "/repo",
    requestId: `req_${id}`,
    message: {
      id: `msg_${id}`,
      model: "claude-opus-5-5",
      usage: { input_tokens: 2, cache_read_input_tokens: 0, output_tokens: 8 },
    },
  })}\n`;

const jobOf = async (
  file: string,
  previous: UsageParseResult | null = null,
  previousSize = 0,
): Promise<UsageParseJob> => {
  const { size, mtimeMs } = await stat(file);
  return {
    runtime: "claude",
    path: file,
    format: "jsonl",
    fingerprint: { size, modifiedAtMs: mtimeMs, fileId: "file" },
    previous: previous && {
      fingerprint: { size: previousSize, modifiedAtMs: 0, fileId: "file" },
      resume: previous.resume,
      parserState: previous.parserState,
      unreadable: previous.issue?.code === "unreadable",
    },
  };
};

describe("parseUsageSource", () => {
  test("continues a grown log after its last complete line", async () => {
    const file = path.join(directory, "session.jsonl");
    await writeFile(file, request("1", "2026-11-04T10:00:00Z"));
    const first = await parseUsageSource(await jobOf(file));
    const firstSize = (await stat(file)).size;
    await appendFile(file, request("2", "2026-11-04T11:00:00Z"));
    const next = await parseUsageSource(await jobOf(file, first, firstSize));

    expect([first.mode, first.units.map((unit) => unit.identity)]).toEqual([
      "replace",
      ["msg_1:req_1"],
    ]);
    expect([next.mode, next.units.map((unit) => unit.identity)]).toEqual([
      "append",
      ["msg_2:req_2"],
    ]);
  });

  test("reads a rewritten log again from its first line", async () => {
    const file = path.join(directory, "session.jsonl");
    await writeFile(file, request("1", "2026-11-04T10:00:00Z"));
    const first = await parseUsageSource(await jobOf(file));
    const firstSize = (await stat(file)).size;
    await writeFile(
      file,
      request("3", "2026-11-04T10:00:00Z") + request("4", "2026-11-04T11:00:00Z"),
    );
    const next = await parseUsageSource(await jobOf(file, first, firstSize));

    expect([next.mode, next.units.map((unit) => unit.identity)]).toEqual([
      "replace",
      ["msg_3:req_3", "msg_4:req_4"],
    ]);
  });

  test("marks a line that is not JSON as malformed, with the dates of the requests around it", async () => {
    const file = path.join(directory, "session.jsonl");
    await writeFile(
      file,
      `${request("1", "2026-11-04T10:00:00Z")}{"type":"assistant",\n${request("2", "2026-11-04T12:00:00Z")}`,
    );
    const result = await parseUsageSource(await jobOf(file));

    expect(result.units).toHaveLength(2);
    expect(result.issue).toEqual({
      code: "malformed_records",
      firstAtMs: Date.parse("2026-11-04T10:00:00Z"),
      lastAtMs: Date.parse("2026-11-04T12:00:00Z"),
    });
  });

  test("keeps the earlier units and the resume point of a log that it cannot read", async () => {
    const file = path.join(directory, "session.jsonl");
    await writeFile(file, request("1", "2026-11-04T10:00:00Z"));
    const first = await parseUsageSource(await jobOf(file));
    const firstSize = (await stat(file)).size;
    const grown = await jobOf(file, first, firstSize);
    // The log grew, and the read of its new lines then fails.
    const missing = {
      ...grown,
      path: `${file}.missing`,
      fingerprint: { ...grown.fingerprint, size: firstSize + 10 },
    };
    const result = await parseUsageSource(missing);

    expect(result).toMatchObject({
      mode: "append",
      units: [],
      resume: first.resume,
      issue: { code: "unreadable", firstAtMs: null, lastAtMs: null },
    });
  });

  test("reports a database without the known OpenCode tables as an unsupported format", async () => {
    const file = path.join(directory, "opencode.db");
    await writeFile(file, "");
    const result = await parseUsageSource({
      ...(await jobOf(file)),
      runtime: "opencode",
      format: "opencode",
    });

    expect(result.issue).toEqual({ code: "unsupported_format", firstAtMs: null, lastAtMs: null });
    expect(result.mode).toBe("append");
  });
});

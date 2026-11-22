import { describe, expect, test } from "bun:test";
import type { UsageSourceRow } from "./usage-index-sources";
import type { DiskSource } from "./usage-source-discovery";
import { planUsageSync } from "./usage-sync-plan";

const disk = (overrides: Partial<DiskSource> = {}): DiskSource => ({
  runtime: "claude",
  path: "/h/a.jsonl",
  format: "jsonl",
  fingerprint: { size: 10, modifiedAtMs: 1_000, fileId: "1:1" },
  ...overrides,
});

const stored = (overrides: Partial<UsageSourceRow> = {}): UsageSourceRow => ({
  id: 1,
  runtime: "claude",
  path: "/h/a.jsonl",
  fingerprint: { size: 10, modifiedAtMs: 1_000, fileId: "1:1" },
  resume: { offset: 10, digest: "d" },
  parserState: null,
  unreadable: false,
  ...overrides,
});

const plan = (input: Partial<Parameters<typeof planUsageSync>[0]>) =>
  planUsageSync({
    runtimes: ["claude", "codex", "opencode"],
    onDisk: [],
    unreadablePaths: [],
    stored: [],
    sinceMs: null,
    ...input,
  });

describe("planUsageSync", () => {
  test("skips an unchanged source, unless its last read failed", () => {
    expect(plan({ onDisk: [disk()], stored: [stored()] }).jobs).toEqual([]);
    const failed = plan({ onDisk: [disk()], stored: [stored({ unreadable: true })] });
    expect(failed.jobs.map((job) => job.previous?.unreadable)).toEqual([true]);
  });

  test("passes a changed source with what its last read kept", () => {
    const grown = disk({ fingerprint: { size: 20, modifiedAtMs: 2_000, fileId: "1:1" } });
    expect(plan({ onDisk: [grown], stored: [stored()] }).jobs).toEqual([
      {
        runtime: "claude",
        path: "/h/a.jsonl",
        format: "jsonl",
        fingerprint: grown.fingerprint,
        previous: {
          fingerprint: stored().fingerprint,
          resume: { offset: 10, digest: "d" },
          parserState: null,
          unreadable: false,
        },
      },
    ]);
  });

  test("waits with a log that changed before the range, but not with a database", () => {
    const old = { size: 10, modifiedAtMs: 500, fileId: "1:1" };
    const result = plan({
      onDisk: [
        disk({ fingerprint: old }),
        disk({ runtime: "opencode", path: "/h/opencode.db", format: "opencode", fingerprint: old }),
      ],
      sinceMs: 1_000,
    });
    expect(result.jobs.map((job) => job.path)).toEqual(["/h/opencode.db"]);
  });

  test("starts the largest sources first", () => {
    const sized = (file: string, size: number, format: DiskSource["format"]) =>
      disk({ path: file, format, fingerprint: { size, modifiedAtMs: 1, fileId: file } });
    const result = plan({
      onDisk: [
        sized("/h/small.jsonl", 100, "jsonl"),
        sized("/h/packed.jsonl.zst", 50, "jsonl_zst"),
        sized("/h/opencode.db", 1, "opencode"),
      ],
    });
    expect(result.jobs.map((job) => job.path)).toEqual([
      "/h/opencode.db",
      "/h/packed.jsonl.zst",
      "/h/small.jsonl",
    ]);
  });

  test("removes deleted sources of the selected runtimes, but keeps unreadable ones", () => {
    const result = plan({
      runtimes: ["claude"],
      unreadablePaths: ["/h/locked"],
      stored: [
        stored({ id: 1, path: "/h/gone.jsonl" }),
        stored({ id: 2, path: "/h/locked/b.jsonl" }),
        stored({ id: 3, runtime: "codex", path: "/h/rollout.jsonl" }),
      ],
    });
    expect(result.removeIds).toEqual([1]);
  });
});

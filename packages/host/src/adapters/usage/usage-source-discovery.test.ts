import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverUsageSources, isInsideAny } from "./usage-source-discovery";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "odt-usage-discovery-"));
});

afterEach(async () => {
  await chmod(path.join(directory, "archived_sessions"), 0o700).catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
});

describe("discoverUsageSources", () => {
  // Windows cannot deny reads with a file mode, and root reads any folder.
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps readable history when another folder of the runtime cannot be read",
    async () => {
      const sessions = path.join(directory, "sessions", "2026", "11", "21");
      const archived = path.join(directory, "archived_sessions");
      await mkdir(sessions, { recursive: true });
      await mkdir(archived);
      const rollout = path.join(sessions, "rollout-a.jsonl");
      await writeFile(rollout, "{}\n");
      await chmod(archived, 0o000);

      const discovery = discoverUsageSources(
        {
          claude: path.join(directory, "missing-claude"),
          codex: [path.join(directory, "sessions"), archived],
          opencode: { directory: path.join(directory, "missing-opencode"), databaseFile: null },
        },
        ["claude", "codex", "opencode"],
      );

      expect(discovery.sources.map((source) => [source.runtime, source.path])).toEqual([
        ["codex", rollout],
      ]);
      expect(discovery.locationIssues).toEqual([{ runtime: "codex", code: "unreadable" }]);
      expect(discovery.unreadablePaths).toEqual([archived]);
      expect(discovery.withoutHistory).toEqual(["claude", "opencode"]);
    },
  );
});

describe("discoverUsageSources fingerprints", () => {
  test("adds the write-ahead log of a database and reads only the selected runtimes", async () => {
    const database = path.join(directory, "opencode.db");
    await writeFile(database, "db");
    const locations = {
      claude: path.join(directory, "missing-claude"),
      codex: [path.join(directory, "missing-codex")],
      opencode: { directory, databaseFile: null },
    };
    const before = discoverUsageSources(locations, ["opencode"]).sources[0];
    await writeFile(`${database}-wal`, "a log write");
    const after = discoverUsageSources(locations, ["opencode"]).sources[0];

    expect(before?.fingerprint.size).toBe(2);
    expect(after?.fingerprint.size).toBe(2 + "a log write".length);
    expect(after?.fingerprint.fileId).toBe(before?.fingerprint.fileId);
    const other = discoverUsageSources(locations, ["claude"]);
    expect(other.sources).toEqual([]);
    expect(other.withoutHistory).toEqual(["claude"]);
  });
});

describe("isInsideAny", () => {
  test("matches the path itself and paths below it only", () => {
    const archived = path.join(directory, "archived");
    expect(isInsideAny(path.join(archived, "a.jsonl"), [archived])).toBe(true);
    expect(isInsideAny(archived, [archived])).toBe(true);
    expect(isInsideAny(path.join(`${archived}-2`, "a.jsonl"), [archived])).toBe(false);
  });
});

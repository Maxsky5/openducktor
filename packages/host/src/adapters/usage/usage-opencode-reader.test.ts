import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { readOpenCodeUsage } from "./usage-opencode-reader";

let directory = "";
let databasePath = "";

type TokensFixture = {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
};

const assistant = (tokens: TokensFixture, settled = true) =>
  JSON.stringify({
    model: { id: "claude-opus-5-5", providerID: "anthropic" },
    tokens,
    time: settled ? { created: 1, completed: 2 } : { created: 1 },
  });

const TOKENS: TokensFixture = { input: 10, output: 4, reasoning: 3, cache: { read: 20, write: 5 } };

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "odt-usage-opencode-"));
  databasePath = path.join(directory, "opencode.db");
  using database = new Database(databasePath);
  database.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL);
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, project_id TEXT, version TEXT);
    CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, time_updated INTEGER, data TEXT);
    INSERT INTO project VALUES ('p', '/repo'), ('global', '/');
    INSERT INTO session_v2 VALUES ('root', NULL, '/repo/sub', 'p', '2.3.2'),
      ('child', 'root', '/repo/sub', 'p', '2.3.2'),
      ('fork', NULL, '/scratch', 'global', '2.3.2');
  `);
  const insert = database.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)");
  insert.run("m1", "root", "assistant", 1, 1000, 1000, assistant(TOKENS));
  insert.run("m2", "child", "assistant", 1, 2000, 2000, assistant({ ...TOKENS, input: 99 }));
  // A fork copies a message with a new ID and the same creation time and tokens.
  insert.run("copy", "fork", "assistant", 1, 1000, 3000, assistant(TOKENS));
  insert.run("running", "root", "assistant", 2, 4000, 4000, assistant(TOKENS, false));
  insert.run(
    "empty",
    "root",
    "assistant",
    3,
    5000,
    5000,
    assistant({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }),
  );
  insert.run("user", "root", "user", 4, 6000, 6000, JSON.stringify({}));
  insert.run(
    "compacted",
    "root",
    "compaction",
    5,
    5500,
    5500,
    JSON.stringify({ status: "completed", tokens: TOKENS, time: { created: 5500 } }),
  );
  insert.run(
    "untracked",
    "root",
    "assistant",
    6,
    5600,
    5600,
    JSON.stringify({ model: { id: "m", providerID: "p" }, time: { created: 1, completed: 2 } }),
  );
});

afterEach(async () => {
  await removeTestDirectory(directory);
});

describe("readOpenCodeUsage", () => {
  test("reads settled assistant messages under their root session and folder", async () => {
    const read = await Effect.runPromise(readOpenCodeUsage(databasePath, null));
    if (read.kind !== "units") throw new Error("Expected units.");
    expect(read.mode).toBe("replace");
    // A settled message with zero tokens or without tokens is still model activity.
    expect(
      read.units.map((unit) => [unit.session, unit.project, unit.tokens?.input ?? null]),
    ).toEqual([
      ["root", "/repo", 10],
      ["root", "/repo", 99],
      ["fork", "/scratch", 10],
      ["root", "/repo", 0],
      ["root", "/repo", 10],
      ["root", "/repo", null],
    ]);
    // Output includes reasoning.
    expect(read.units[0]?.tokens).toEqual({
      input: 10,
      cacheRead: 20,
      cacheWrite5m: 5,
      cacheWrite1h: 0,
      output: 7,
    });
    expect(read.units[2]?.identity).toBe(read.units[0]?.identity);
  });

  test("reads only changed rows, and everything again after a deletion", async () => {
    const first = await Effect.runPromise(readOpenCodeUsage(databasePath, null));
    if (first.kind !== "units") throw new Error("Expected units.");
    {
      using database = new Database(databasePath);
      database.run(
        "UPDATE session_message SET data = ?, time_updated = 7000 WHERE id = 'running'",
        [assistant(TOKENS)],
      );
    }
    const next = await Effect.runPromise(readOpenCodeUsage(databasePath, first.state));
    if (next.kind !== "units") throw new Error("Expected units.");
    expect(next.mode).toBe("append");
    expect(next.units).toHaveLength(1);
    {
      // A fork copies a message with its old update time; its new row ID shows it.
      using database = new Database(databasePath);
      database.run("INSERT INTO session_v2 VALUES ('fork2', NULL, '/scratch', 'global', '2.3.2')");
      database.run("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)", [
        "copy2",
        "fork2",
        "assistant",
        1,
        1000,
        1000,
        assistant(TOKENS),
      ]);
    }
    const forked = await Effect.runPromise(readOpenCodeUsage(databasePath, next.state));
    if (forked.kind !== "units") throw new Error("Expected units.");
    expect(forked.mode).toBe("append");
    expect(forked.units.map((unit) => unit.session)).toContain("fork2");
    {
      // More new rows than deleted rows: the table grows, and the deletion still shows.
      using database = new Database(databasePath);
      database.run("DELETE FROM session_message WHERE id = 'm2'");
      const insert = database.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)");
      insert.run("n1", "root", "assistant", 7, 8000, 8000, assistant({ ...TOKENS, input: 1 }));
      insert.run("n2", "root", "assistant", 8, 8001, 8001, assistant({ ...TOKENS, input: 2 }));
    }
    const after = await Effect.runPromise(readOpenCodeUsage(databasePath, forked.state));
    if (after.kind !== "units") throw new Error("Expected units.");
    expect(after.mode).toBe("replace");
    expect(after.units.map((unit) => unit.tokens?.input)).not.toContain(99);
    expect(after.units).toHaveLength(9);
  });

  test("reads everything again when a replacement row takes the row ID of a deleted one", async () => {
    {
      using database = new Database(databasePath);
      database.run("INSERT INTO session_v2 VALUES ('forkA', NULL, '/scratch', 'global', '2.3.2')");
      database.run("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)", [
        "copyA",
        "forkA",
        "assistant",
        1,
        1000,
        1000,
        assistant(TOKENS),
      ]);
    }
    const first = await Effect.runPromise(readOpenCodeUsage(databasePath, null));
    if (first.kind !== "units") throw new Error("Expected units.");
    {
      // The latest fork goes, and another fork of the same history takes its row ID.
      using database = new Database(databasePath);
      database.run("DELETE FROM session_message WHERE id = 'copyA'");
      database.run("INSERT INTO session_v2 VALUES ('forkB', NULL, '/scratch', 'global', '2.3.2')");
      database.run("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)", [
        "copyB",
        "forkB",
        "assistant",
        1,
        1000,
        1000,
        assistant(TOKENS),
      ]);
    }
    const next = await Effect.runPromise(readOpenCodeUsage(databasePath, first.state));
    if (next.kind !== "units") throw new Error("Expected units.");
    expect(next.mode).toBe("replace");
    const sessions = next.units.map((unit) => unit.session);
    expect(sessions).toContain("forkB");
    expect(sessions).not.toContain("forkA");
  });

  test("digests tables larger than one identity batch", async () => {
    {
      using database = new Database(databasePath);
      const insert = database.prepare(
        "INSERT INTO session_message VALUES (?, 'root', 'user', 0, 1, 1, '{}')",
      );
      database.transaction(() => {
        for (let index = 0; index < 25_000; index++) insert.run(`u${index}`);
      })();
    }
    const first = await Effect.runPromise(readOpenCodeUsage(databasePath, null));
    if (first.kind !== "units") throw new Error("Expected units.");
    const same = await Effect.runPromise(readOpenCodeUsage(databasePath, first.state));
    if (same.kind !== "units") throw new Error("Expected units.");
    expect(same.mode).toBe("append");
    {
      // A deletion in a later batch still shows.
      using database = new Database(databasePath);
      database.run("DELETE FROM session_message WHERE id = 'u20000'");
    }
    const after = await Effect.runPromise(readOpenCodeUsage(databasePath, same.state));
    if (after.kind !== "units") throw new Error("Expected units.");
    expect(after.mode).toBe("replace");
  });

  test("reports a database without the known tables as unsupported", async () => {
    {
      using database = new Database(databasePath);
      database.exec("ALTER TABLE session_message RENAME COLUMN data TO payload");
    }
    expect(await Effect.runPromise(readOpenCodeUsage(databasePath, null))).toEqual({
      kind: "unsupported",
    });
  });
});

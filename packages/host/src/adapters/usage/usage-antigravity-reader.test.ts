import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { antigravityRateModel, readAntigravityUsage } from "./usage-antigravity-reader";

/** A protocol buffer field: a varint, or bytes of a string, packed varints, or a message. */
type Field =
  | { number: number; kind: "varint"; value: number }
  | { number: number; kind: "bytes"; value: Uint8Array }
  | { number: number; kind: "message"; value: Field[] };

const num = (number: number, value: number): Field => ({ number, kind: "varint", value });
const str = (number: number, value: string): Field => ({
  number,
  kind: "bytes",
  value: new TextEncoder().encode(value),
});
const msg = (number: number, value: Field[]): Field => ({ number, kind: "message", value });

const varint = (value: number): number[] => {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return bytes;
};

const encode = (fields: Field[]): Uint8Array => {
  const bytes: number[] = [];
  for (const field of fields) {
    if (field.kind === "varint") {
      bytes.push(...varint(field.number * 8), ...varint(field.value));
      continue;
    }
    const body = field.kind === "bytes" ? field.value : encode(field.value);
    bytes.push(...varint(field.number * 8 + 2), ...varint(body.length), ...body);
  }
  return Uint8Array.from(bytes);
};

const packed = (values: number[]) => Uint8Array.from(values.flatMap(varint));
const label = (key: string, value: string): Field => msg(20, [str(1, key), str(2, value)]);
const timestamp = (number: number, seconds: number, nanos = 0): Field =>
  msg(number, [num(1, seconds), num(2, nanos)]);

/** One model call as the Antigravity CLI 1.5.14 writes it in `gen_metadata`. */
const call = ({
  steps,
  model,
  usage,
  labels,
}: {
  steps: number[];
  model: string | null;
  usage: Field[];
  labels: Field[];
}) =>
  encode([
    { number: 2, kind: "bytes", value: packed(steps) },
    msg(1, [
      msg(4, [num(1, 1035), ...usage, num(6, 26)]),
      ...(model === null ? [] : [str(19, model)]),
      ...labels,
    ]),
  ]);

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "odt-usage-antigravity-"));
});

afterEach(async () => {
  await removeTestDirectory(directory);
});

const createConversation = (id: string, rows: Uint8Array[]) => {
  const file = path.join(directory, `${id}.db`);
  using database = new Database(file);
  database.exec(`
    CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY DEFAULT 'main', data BLOB);
    CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB);
    CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER NOT NULL DEFAULT 0);
  `);
  database
    .query("INSERT INTO trajectory_metadata_blob (id, data) VALUES ('main', ?)")
    .run(
      encode([msg(1, [str(1, "file:///repo/app"), str(4, "main")]), timestamp(2, 1_795_370_290)]),
    );
  const step = database.query(
    "INSERT INTO steps (idx, step_type, status, metadata) VALUES (?, 14, 3, ?)",
  );
  step.run(0, encode([timestamp(1, 1_795_370_291)]));
  step.run(1, encode([timestamp(1, 1_795_370_292, 500_000_000)]));
  step.run(2, encode([timestamp(1, 1_795_370_294)]));
  const generation = database.query("INSERT INTO gen_metadata (idx, data) VALUES (?, ?)");
  rows.forEach((row, index) => generation.run(index, row));
  return file;
};

const read = (file: string) =>
  Effect.runPromise(readAntigravityUsage(file, path.basename(file, ".db")));

describe("readAntigravityUsage", () => {
  test("reads each model call with its tokens, time, conversation, and folder", async () => {
    const file = createConversation("child", [
      call({
        steps: [1],
        model: "claude-sonnet-4-6",
        usage: [num(2, 23528), num(3, 182), num(10, 182)],
        labels: [
          label("cascade_id", "child"),
          label("root_cascade_id", "root"),
          label("request_id", "trajectory-1"),
          label("last_step_index", "0"),
        ],
      }),
      call({
        steps: [],
        model: "gemini-3.8-flash-n",
        usage: [num(2, 952), num(3, 159), num(5, 23031), num(9, 113), num(10, 46)],
        labels: [label("cascade_id", "child"), label("last_step_index", "2")],
      }),
      // A call that failed before the model answered has no model and no tokens.
      call({ steps: [], model: null, usage: [], labels: [label("cascade_id", "child")] }),
    ]);

    const result = await read(file);

    expect(result).toEqual({
      kind: "units",
      malformed: 0,
      units: [
        {
          identity: "trajectory-1",
          occurredAtMs: 1_795_370_292_500,
          // A sub-agent conversation counts under the conversation that started it.
          session: "root",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          project: "/repo/app",
          serviceTier: null,
          tokens: { input: 23528, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 182 },
        },
        {
          identity: "child:1",
          // Without its own step, a call takes the time of the step before it.
          occurredAtMs: 1_795_370_294_000,
          session: "child",
          provider: "google",
          model: "gemini-3.8-flash",
          project: "/repo/app",
          serviceTier: null,
          // The output includes the thinking tokens.
          tokens: { input: 952, cacheRead: 23031, cacheWrite5m: 0, cacheWrite1h: 0, output: 159 },
        },
      ],
    });
  });

  test("counts a call without token counts as unmeasured and a broken row as malformed", async () => {
    const file = createConversation("conversation", [
      call({ steps: [0], model: "gemini-3.8-flash-n", usage: [], labels: [] }),
      Uint8Array.from([0x0a, 0x05, 0x01]),
    ]);

    const result = await read(file);

    expect(result.kind === "units" ? result.malformed : null).toBe(1);
    expect(result.kind === "units" ? result.units.map((unit) => unit.tokens) : null).toEqual([
      null,
    ]);
  });

  test("reports a database without the conversation tables as unsupported", async () => {
    const file = path.join(directory, "other.db");
    using database = new Database(file);
    database.exec("CREATE TABLE something (id INTEGER)");

    expect(await read(file)).toEqual({ kind: "unsupported" });
  });
});

describe("antigravityRateModel", () => {
  test("names the models.dev model of each Antigravity model ID", () => {
    expect(antigravityRateModel("gemini-3.8-flash-tiered")).toEqual({
      provider: "google",
      model: "gemini-3.8-flash",
    });
    expect(antigravityRateModel("claude-opus-4-6-thinking")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
    expect(antigravityRateModel("gpt-oss-120b-medium")).toEqual({
      provider: "google-vertex",
      model: "openai/gpt-oss-120b-maas",
    });
    expect(antigravityRateModel("other-model")).toEqual({ provider: null, model: "other-model" });
  });
});

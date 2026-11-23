import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { z } from "zod";
import type { UsageTokens, UsageUnit } from "../../domain/usage/usage-unit";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import { openSqliteDatabase, type SqliteDatabase } from "../../infrastructure/sqlite/sqlite-driver";
import {
  bytesOf,
  messageOf,
  type ProtobufField,
  readPackedVarints,
  readProtobufFields,
  textOf,
  timestampMsOf,
  varintOf,
} from "./usage-protobuf-fields";

/**
 * Field numbers of the Antigravity conversation messages, as the CLI 1.5.14 writes them. The
 * Antigravity CLI publishes no schema; the token sums match the usage that ACP reports.
 */
const GENERATION = { steps: 2, call: 1 } as const;
const CALL = { usage: 4, labels: 20, model: 19 } as const;
const USAGE = { input: 2, output: 3, cacheRead: 5 } as const;
const LABEL = { key: 1, value: 2 } as const;
const STEP_CREATED = 1;
const TRAJECTORY = { workspace: 1, created: 2 } as const;
const WORKSPACE_URI = 1;

/** The tables and columns that a conversation database must have. */
const TABLES = {
  gen_metadata: ["idx", "data"],
  steps: ["idx", "metadata"],
  trajectory_metadata_blob: ["id", "data"],
} as const;

/** One row of `gen_metadata`: one model call. */
type GenerationRow = { idx: number; data: Uint8Array };

/** What a conversation database holds for its model calls. */
type AntigravityConversation = {
  /** The cascade ID of the conversation: the file name without `.db`. */
  id: string;
  /** The working folder of the conversation. */
  project: string | null;
  createdAtMs: number | null;
  /** The creation time of each step by its index. */
  stepTimes: ReadonlyMap<number, number>;
  generations: readonly GenerationRow[];
};

/** The model calls of a conversation, and the rows that are not call messages. */
type AntigravityUnits = { units: UsageUnit[]; malformed: number };

/**
 * The models.dev provider of a call, from the labels that Antigravity records with it: a Claude
 * call is Anthropic, and a Gemini call is Google. Antigravity names no provider for its other
 * models, so their calls have none. The recorded model ID can end in a variant, such as a thinking
 * level, and the price lookup of the index resolves it.
 */
const providerOf = (labels: ReadonlyMap<string, string>): string | null => {
  if (labels.get("used_claude") === "true") return "anthropic";
  return labels.get("used_non_gemini_model") === "false" ? "google" : null;
};

/** The labels of a call: key and value pairs such as `root_cascade_id`. */
const labelsOf = (call: readonly ProtobufField[]) => {
  const labels = new Map<string, string>();
  for (const bytes of bytesOf(call, CALL.labels)) {
    const label = readProtobufFields(bytes);
    const key = label === null ? null : textOf(label, LABEL.key);
    const value = label === null ? null : textOf(label, LABEL.value);
    if (key !== null && value !== null) labels.set(key, value);
  }
  return labels;
};

const tokensOf = (call: readonly ProtobufField[]): UsageTokens | null => {
  const usage = messageOf(call, CALL.usage);
  const input = usage === null ? null : varintOf(usage, USAGE.input);
  const output = usage === null ? null : varintOf(usage, USAGE.output);
  if (usage === null || input === null || output === null) return null;
  // Antigravity reports no cache writes. The output includes the thinking tokens.
  return {
    input,
    cacheRead: varintOf(usage, USAGE.cacheRead) ?? 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    output,
  };
};

/**
 * The model calls of one conversation. A call takes the creation time of the first step that it
 * produced, or of the step before it. A call without a model failed before the model answered,
 * so it is not a request. A row that is not a call message counts as malformed.
 */
const antigravityUsageUnits = (conversation: AntigravityConversation): AntigravityUnits => {
  const units: UsageUnit[] = [];
  let malformed = 0;
  for (const row of conversation.generations) {
    const fields = readProtobufFields(row.data);
    const call = fields === null ? null : messageOf(fields, GENERATION.call);
    if (fields === null || call === null) {
      malformed++;
      continue;
    }
    const recorded = textOf(call, CALL.model);
    if (recorded === null) continue;
    const labels = labelsOf(call);
    const [stepBytes] = bytesOf(fields, GENERATION.steps);
    const steps = stepBytes === undefined ? [] : (readPackedVarints(stepBytes) ?? []);
    const previousStep = Number(labels.get("last_step_index"));
    const occurredAtMs =
      steps.map((step) => conversation.stepTimes.get(step)).find((time) => time !== undefined) ??
      conversation.stepTimes.get(previousStep) ??
      conversation.createdAtMs;
    if (occurredAtMs === null) {
      malformed++;
      continue;
    }
    const cascade = labels.get("cascade_id") ?? conversation.id;

    units.push({
      identity: labels.get("request_id") ?? `${cascade}:${row.idx}`,
      occurredAtMs,
      // A sub-agent conversation names the conversation that started it.
      session: labels.get("root_cascade_id") ?? cascade,
      provider: providerOf(labels),
      model: recorded,
      project: conversation.project,
      serviceTier: null,
      tokens: tokensOf(call),
    });
  }
  return { units, malformed };
};

const columnRowSchema = z.tuple([z.unknown(), z.string()]).rest(z.unknown());
const generationRowSchema = z.tuple([z.number(), z.instanceof(Uint8Array)]);
const stepRowSchema = z.tuple([z.number(), z.instanceof(Uint8Array).nullable()]);
const blobRowSchema = z.tuple([z.instanceof(Uint8Array).nullable()]);

const valuesOf = (database: SqliteDatabase, sql: string) =>
  database.prepare(sql).pipe(Effect.flatMap((statement) => statement.values()));

const hasTables = (database: SqliteDatabase) =>
  Effect.gen(function* () {
    for (const [table, columns] of Object.entries(TABLES)) {
      const rows = yield* valuesOf(database, `PRAGMA table_info(${table})`);
      const present = new Set(
        rows.flatMap((row) => columnRowSchema.safeParse(row).data?.[1] ?? []),
      );
      if (!columns.every((column) => present.has(column))) return false;
    }
    return true;
  });

/** The working folder of a `file://` URI, or null for another form. */
const folderOf = (uri: string | null): string | null => {
  if (uri === null || !uri.startsWith("file://")) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
};

export type AntigravityRead =
  | { kind: "unsupported" }
  | { kind: "units"; units: UsageUnit[]; malformed: number };

/** Reads the model calls of one Antigravity conversation database, read-only. */
export const readAntigravityUsage = (
  path: string,
  id: string,
): Effect.Effect<AntigravityRead, HostOperationErrorAggregate> =>
  Effect.acquireUseRelease(
    openSqliteDatabase(path, undefined, { readonly: true }),
    (database) =>
      Effect.gen(function* () {
        yield* database.exec("PRAGMA busy_timeout = 1000");
        // One read transaction: the steps and the calls come from the same snapshot.
        yield* database.exec("BEGIN");
        if (!(yield* hasTables(database))) return { kind: "unsupported" } as const;
        const [trajectoryRow] = yield* valuesOf(
          database,
          "SELECT data FROM trajectory_metadata_blob WHERE id = 'main'",
        );
        const trajectoryBytes = blobRowSchema.safeParse(trajectoryRow).data?.[0] ?? null;
        const trajectory = trajectoryBytes === null ? null : readProtobufFields(trajectoryBytes);
        const workspace = trajectory === null ? null : messageOf(trajectory, TRAJECTORY.workspace);
        const stepTimes = new Map<number, number>();
        for (const row of yield* valuesOf(database, "SELECT idx, metadata FROM steps")) {
          const parsed = stepRowSchema.safeParse(row);
          const metadata = parsed.data?.[1] ? readProtobufFields(parsed.data[1]) : null;
          const created =
            metadata === null ? null : timestampMsOf(messageOf(metadata, STEP_CREATED));
          if (parsed.data && created !== null) stepTimes.set(parsed.data[0], created);
        }
        const generations: GenerationRow[] = [];
        let malformedRows = 0;
        for (const row of yield* valuesOf(
          database,
          "SELECT idx, data FROM gen_metadata ORDER BY idx",
        )) {
          const parsed = generationRowSchema.safeParse(row);
          if (parsed.success) generations.push({ idx: parsed.data[0], data: parsed.data[1] });
          else malformedRows++;
        }
        const read = antigravityUsageUnits({
          id,
          project: folderOf(workspace === null ? null : textOf(workspace, WORKSPACE_URI)),
          createdAtMs:
            trajectory === null ? null : timestampMsOf(messageOf(trajectory, TRAJECTORY.created)),
          stepTimes,
          generations,
        });
        return {
          kind: "units",
          units: read.units,
          malformed: read.malformed + malformedRows,
        } as const;
      }),
    (database) => database.close().pipe(Effect.ignore),
  );

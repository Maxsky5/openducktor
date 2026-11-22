import { z } from "zod";
import type { UsageUnit } from "../../domain/usage/usage-unit";
import { createCodexResponseTracker } from "./usage-codex-responses";
import {
  codexRawUsageSchema,
  codexTokensOf,
  type CodexUsage,
  codexUsageOf,
  codexUsageSchema,
  isNewCodexSnapshot,
} from "./usage-codex-tokens";
import {
  isReviewExit,
  itemRoleOf,
  type LinePrefix,
  lineKindOf,
  linePrefixOf,
  READ_EVENTS,
  READ_RECORDS,
} from "./usage-codex-lines";

const count = z.number().int().nonnegative();
const label = z.string().min(1).optional().catch(undefined);

const timestamp = z.iso.datetime({ offset: true });

const recordSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session_meta"),
    payload: z.object({
      id: label,
      session_id: label,
      parent_thread_id: label,
      subagent_history_start_ordinal: count.optional().catch(undefined),
      model_provider: label,
      cwd: label,
      cli_version: label,
      source: z
        .object({
          subagent: z
            .object({
              thread_spawn: z.object({ parent_thread_id: label }).optional().catch(undefined),
            })
            .optional()
            .catch(undefined),
        })
        .optional()
        .catch(undefined),
    }),
  }),
  z.object({
    type: z.literal("turn_context"),
    payload: z.object({ turn_id: label, model: label, cwd: label }),
  }),
  z.object({
    type: z.literal("token_usage_record"),
    timestamp,
    payload: z.object({
      thread_id: label,
      session_id: label,
      response_id: label,
      usage: codexRawUsageSchema.optional().catch(undefined),
    }),
  }),
  z.object({
    type: z.literal("event_msg"),
    timestamp,
    payload: z.discriminatedUnion("type", [
      z.object({ type: z.literal("task_started"), turn_id: label }),
      z.object({ type: z.literal("task_complete"), turn_id: label }),
      z.object({ type: z.literal("turn_aborted"), turn_id: label }),
      z.object({
        type: z.literal("thread_settings_applied"),
        thread_id: label,
        thread_settings: z.object({
          model: label,
          model_provider_id: label,
          service_tier: label,
          cwd: label,
        }),
      }),
      z.object({
        type: z.literal("token_count"),
        info: z
          .object({
            total_token_usage: codexRawUsageSchema.optional().catch(undefined),
            last_token_usage: codexRawUsageSchema.optional().catch(undefined),
          })
          .nullable(),
      }),
    ]),
  }),
]);

type CodexRecord = z.infer<typeof recordSchema>;

/** A context checkpoint. A compaction that sampled the model names its response. */
const compactionSchema = z.object({
  timestamp,
  payload: z.object({ compaction_response_id: z.string().min(1).nullable().optional() }),
});

const recordKindSchema = z.object({
  type: z.string(),
  payload: z
    .object({ type: z.string().optional().catch(undefined) })
    .optional()
    .catch(undefined),
});

/** The first CLI version that writes one `token_usage_record` per response. */
const RECORD_ERA_MAJOR = 0;
const RECORD_ERA_MINOR = 153;

const isRecordEraVersion = (version: string | null): boolean => {
  const match = version === null ? null : /^(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > RECORD_ERA_MAJOR || (major === RECORD_ERA_MAJOR && minor >= RECORD_ERA_MINOR);
};

/** What a later read of a growing rollout needs to continue. */
export const codexParserStateSchema = z.object({
  thread: z.string().nullable(),
  root: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  cwd: z.string().nullable(),
  serviceTier: z.string().nullable(),
  turnId: z.string().nullable(),
  recordEra: z.boolean(),
  previousTotal: codexUsageSchema.nullable(),
  /** Model responses of the current turn so far. It numbers responses without usage records. */
  turnResponses: count,
  /** The first line ordinal of a subagent's own history. Earlier lines copy its parent. */
  ownFromOrdinal: count.nullable(),
  /**
   * True after a copy of another thread's history without a boundary, from Codex versions
   * before `subagent_history_start_ordinal`. Output without a record then has no known owner.
   */
  copiedHistory: z.boolean(),
  /** True after the end of a `/review`, until the note that Codex writes for it. */
  reviewNoteNext: z.boolean(),
});
export type CodexParserState = z.infer<typeof codexParserStateSchema>;

export const initialCodexParserState = (): CodexParserState => ({
  thread: null,
  root: null,
  provider: null,
  model: null,
  cwd: null,
  serviceTier: null,
  turnId: null,
  recordEra: false,
  previousTotal: null,
  turnResponses: 0,
  ownFromOrdinal: null,
  copiedHistory: false,
  reviewNoteNext: false,
});

type SessionMeta = Extract<CodexRecord, { type: "session_meta" }>["payload"];

const readSessionMeta = (state: CodexParserState, payload: SessionMeta) => {
  // A forked subagent can copy the parent's metadata after its own. Only the first one counts.
  if (state.thread !== null) {
    // Without a boundary, the copy's end is not known.
    if (state.ownFromOrdinal === null) state.copiedHistory = true;
    return;
  }
  state.thread = payload.id ?? null;
  const sessionId = payload.session_id ?? null;
  // `session_id` names the root thread. Older subagents repeat their own ID there.
  state.root =
    sessionId !== null && sessionId !== state.thread
      ? sessionId
      : (payload.parent_thread_id ??
        payload.source?.subagent?.thread_spawn?.parent_thread_id ??
        state.thread);
  state.provider = payload.model_provider ?? state.provider;
  state.cwd = payload.cwd ?? state.cwd;
  state.recordEra = isRecordEraVersion(payload.cli_version ?? null);
  state.ownFromOrdinal = payload.subagent_history_start_ordinal ?? null;
};

const unitBase = (state: CodexParserState, occurredAtMs: number, session: string) => ({
  occurredAtMs,
  session,
  provider: state.provider,
  model: state.model,
  project: state.cwd,
  serviceTier: state.serviceTier,
});

/** The request of a new cumulative snapshot from a CLI before 0.153. */
const legacyUnit = (
  state: CodexParserState,
  occurredAtMs: number,
  total: CodexUsage,
  last: CodexUsage,
): UsageUnit[] => {
  const session = state.root ?? state.thread;
  if (session === null) return [];
  return [
    {
      ...unitBase(state, occurredAtMs, session),
      // Fork copies keep the turn and the cumulative totals.
      identity: `${state.turnId ?? ""}|${total.input},${total.cached},${total.output},${total.total}`,
      tokens: codexTokensOf(last),
    },
  ];
};

export type CodexRolloutParser = {
  readonly state: CodexParserState;
  /** The units of one line, or null for a record of a read type in an unknown shape. */
  line(line: Buffer): UsageUnit[] | null;
  /**
   * Ends the read. A response without a usage record yet becomes an unmeasured request. It is
   * provisional while the rollout can still grow and record its counts.
   */
  finish(): { units: UsageUnit[] | null; provisional: boolean };
};

/**
 * Turns the records of one Codex rollout into model requests. Files from CLI 0.153 write one
 * `token_usage_record` per response. Older files only have cumulative `token_count` snapshots.
 * Responses that Codex never measured come from the response tracker.
 */
export const createCodexRolloutParser = (state: CodexParserState): CodexRolloutParser => {
  const responses = createCodexResponseTracker(() => state.root ?? state.thread);

  /** Ends the current turn. A review note never outlives the turn of its review. */
  const endTurn = () => {
    state.reviewNoteNext = false;
    return responses.end();
  };

  const startTurn = (turnId: string | undefined): UsageUnit[] | null => {
    if (turnId === undefined || turnId === state.turnId) return [];
    const flushed = endTurn();
    state.turnId = turnId;
    state.turnResponses = 0;
    return flushed;
  };

  const readItem = (line: Buffer, item: string | null, prefix: LinePrefix) => {
    const role = itemRoleOf(line, item);
    if (role === "input") {
      responses.input();
      return [];
    }
    if (role === "other" || state.turnId === null) return [];
    if (item === "message" && state.reviewNoteNext) {
      state.reviewNoteNext = false;
      return [];
    }
    if (responses.continuesRun()) return [];
    const atMs = prefix.timestamp === null ? Number.NaN : Date.parse(prefix.timestamp);
    // A model item without a readable timestamp at its start.
    if (Number.isNaN(atMs)) return null;
    const { occurredAtMs: _at, session: _session, ...attribution } = unitBase(state, atMs, "");
    const index = state.turnResponses;
    state.turnResponses += 1;
    return responses.output({
      atMs,
      line,
      turnId: state.turnId,
      index,
      attribution,
      copied: state.copiedHistory,
    });
  };

  const readRecord = (line: Buffer): UsageUnit[] | null => {
    const value: unknown = JSON.parse(line.toString("utf8"));
    // Other records carry no usage.
    const kind = recordKindSchema.safeParse(value);
    if (!kind.success) return [];
    const read =
      kind.data.type === "event_msg"
        ? READ_EVENTS.has(kind.data.payload?.type ?? "")
        : READ_RECORDS.has(kind.data.type);
    if (!read) return [];
    const parsed = recordSchema.safeParse(value);
    // A record of a type that the parser reads, in an unknown shape.
    if (!parsed.success) return null;
    const record = parsed.data;
    switch (record.type) {
      case "session_meta":
        readSessionMeta(state, record.payload);
        return [];
      case "turn_context": {
        const flushed = startTurn(record.payload.turn_id);
        state.model = record.payload.model ?? state.model;
        state.cwd = record.payload.cwd ?? state.cwd;
        return flushed;
      }
      case "token_usage_record": {
        state.recordEra = true;
        // A copy from another thread also covers the copied response.
        responses.covered();
        const { payload } = record;
        // A thread can hold a copy of a record of its parent. The parent's file counts it.
        if (payload.response_id === undefined) return [];
        if (state.thread !== null && payload.thread_id !== state.thread) return [];
        state.copiedHistory = false;
        const session = payload.session_id ?? state.root ?? state.thread;
        if (session === null) return [];
        const usage = codexUsageOf(payload.usage);
        return [
          {
            ...unitBase(state, Date.parse(record.timestamp), session),
            identity: payload.response_id,
            tokens: usage === null ? null : codexTokensOf(usage),
          },
        ];
      }
      case "event_msg": {
        const { payload } = record;
        if (payload.type === "thread_settings_applied") {
          const settings = payload.thread_settings;
          state.model = settings.model ?? state.model;
          state.provider = settings.model_provider_id ?? state.provider;
          state.serviceTier = settings.service_tier ?? null;
          state.cwd = settings.cwd ?? state.cwd;
          // Settings of the own thread end a copy of another thread's history.
          if (payload.thread_id !== undefined && payload.thread_id === state.thread)
            state.copiedHistory = false;
          return [];
        }
        if (payload.type === "task_started") return startTurn(payload.turn_id);
        if (payload.type === "task_complete" || payload.type === "turn_aborted")
          return payload.turn_id === undefined || payload.turn_id === state.turnId ? endTurn() : [];
        if (payload.info === null) return [];
        const total = codexUsageOf(payload.info.total_token_usage);
        const last = codexUsageOf(payload.info.last_token_usage);
        if (total === null || last === null) return [];
        const previous = state.previousTotal;
        state.previousTotal = total;
        if (!isNewCodexSnapshot(previous, total, last)) return [];
        // A new snapshot measured the response, in every era. A newer file can hold a copy of
        // older history, where the snapshots are the only measurement. From CLI 0.153, the
        // usage record counts the request, and the snapshot only repeats it.
        responses.covered();
        return state.recordEra ? [] : legacyUnit(state, Date.parse(record.timestamp), total, last);
      }
    }
  };

  /**
   * A compaction that sampled the model is one request, with its response ID. Codex writes a
   * usage record with the same ID when the response has counts, and the copies then merge. Only
   * the checkpoint's own field counts: nested data, such as a tool schema, can repeat the key.
   * Checkpoints are rare (29 lines, 10 MB in a month of the reference history), so a full parse
   * costs little.
   */
  const readCompaction = (line: Buffer): UsageUnit[] | null => {
    const parsed = compactionSchema.safeParse(JSON.parse(line.toString("utf8")));
    if (!parsed.success) return null;
    const responseId = parsed.data.payload.compaction_response_id ?? null;
    const session = state.root ?? state.thread;
    if (responseId === null || session === null) return [];
    return [
      {
        ...unitBase(state, Date.parse(parsed.data.timestamp), session),
        identity: responseId,
        tokens: null,
      },
    ];
  };

  return {
    state,
    line: (line) => {
      const kind = lineKindOf(line);
      const prefix = linePrefixOf(line);
      // Lines before `subagent_history_start_ordinal` are inherited context. Copied output there
      // can belong to the parent, so it is no evidence of a request. Usage records and
      // compactions there count: Codex never copies a parent's usage records, a guardian
      // subagent keeps its own measured history there, and copies with a response ID merge.
      const inherited =
        state.ownFromOrdinal !== null &&
        prefix.ordinal !== null &&
        prefix.ordinal < state.ownFromOrdinal;
      if (kind?.record === "response_item")
        return inherited ? [] : readItem(line, kind.item, prefix);
      if (kind !== null && isReviewExit(line, kind)) {
        if (inherited) return [];
        state.reviewNoteNext = true;
        return [];
      }
      if (kind?.record === "compacted") return readCompaction(line);
      return readRecord(line);
    },
    finish: () => {
      const provisional = responses.waiting();
      return { units: responses.end(), provisional };
    },
  };
};

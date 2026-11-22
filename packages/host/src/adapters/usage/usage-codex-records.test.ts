import { describe, expect, test } from "bun:test";
import { CODEX_USAGE_LINE_FILTER } from "./usage-codex-lines";
import { createCodexRolloutParser, initialCodexParserState } from "./usage-codex-records";

const meta = (cliVersion: string, extra: { id?: string; parent_thread_id?: string } = {}) => ({
  timestamp: "2026-11-16T22:21:18.684Z",
  type: "session_meta",
  payload: {
    id: "thread",
    cwd: "/repo",
    model_provider: "openai",
    cli_version: cliVersion,
    ...extra,
  },
});
const turn = (turnId: string) => ({
  timestamp: "2026-11-16T22:21:19.550Z",
  type: "turn_context",
  payload: { turn_id: turnId, model: "gpt-6.1-sol", cwd: "/repo/sub" },
});
const settings = (tier: string) => ({
  timestamp: "2026-11-16T22:21:19.550Z",
  type: "event_msg",
  payload: {
    type: "thread_settings_applied",
    thread_settings: { model: "gpt-6.1-sol", model_provider_id: "openai", service_tier: tier },
  },
});
const usage = (input: number, cached: number, output: number) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  output_tokens: output,
  total_tokens: input + output,
});
const record = (responseId: string, threadId = "thread") => ({
  timestamp: "2026-11-16T22:21:25.509Z",
  type: "token_usage_record",
  payload: {
    thread_id: threadId,
    session_id: "root",
    response_id: responseId,
    usage: usage(100, 60, 7),
  },
});
type UsageFixture = ReturnType<typeof usage>;
const tokenCount = (total: UsageFixture, last: UsageFixture) => ({
  timestamp: "2026-04-21T19:46:00.000Z",
  type: "event_msg",
  payload: { type: "token_count", info: { total_token_usage: total, last_token_usage: last } },
});

/** A rollout line before encoding. */
type RolloutFixture = {
  timestamp?: string;
  ordinal?: number;
  type: string;
  payload: object | number;
};
type ItemFixture = {
  type: string;
  id?: string;
  role?: string;
  content?: string[];
  encrypted_content?: string;
};

const line = (entry: RolloutFixture) => Buffer.from(JSON.stringify(entry));
const at = (time: string) => `2026-11-16T22:${time}.000Z`;

const parse = (records: RolloutFixture[]) => {
  const parser = createCodexRolloutParser(initialCodexParserState());
  const units = records.flatMap((entry) => parser.line(line(entry)) ?? []);
  return [...units, ...(parser.finish().units ?? [])];
};

describe("codexUsageUnits", () => {
  test("reads one request per usage record, with input apart from cache reads", () => {
    const [unit, ...rest] = parse([
      meta("0.169.0"),
      turn("t1"),
      settings("default"),
      record("resp_1"),
    ]);
    expect(rest).toEqual([]);
    expect(unit).toEqual({
      identity: "resp_1",
      occurredAtMs: Date.parse("2026-11-16T22:21:25.509Z"),
      session: "root",
      provider: "openai",
      model: "gpt-6.1-sol",
      project: "/repo/sub",
      serviceTier: "default",
      tokens: { input: 40, cacheRead: 60, cacheWrite5m: 0, cacheWrite1h: 0, output: 7 },
    });
  });

  test("ignores snapshots in a record-era file and records copied from another thread", () => {
    const units = parse([
      meta("0.169.0"),
      tokenCount(usage(100, 60, 7), usage(100, 60, 7)),
      record("resp_parent", "parent"),
      record("resp_1"),
    ]);
    expect(units.map((unit) => unit.identity)).toEqual(["resp_1"]);
  });

  test("reads legacy snapshots once and skips repeats and context estimates", () => {
    const first = usage(100, 60, 7);
    const second = usage(250, 160, 17);
    const units = parse([
      meta("0.121.0"),
      turn("t1"),
      tokenCount(first, first),
      tokenCount(first, first),
      tokenCount(second, usage(150, 100, 10)),
      tokenCount({ ...second, total_tokens: 999 }, usage(0, 0, 0)),
    ]);
    expect(units.map((unit) => [unit.identity, unit.tokens?.input, unit.tokens?.output])).toEqual([
      ["t1|100,60,7,107", 40, 7],
      ["t1|250,160,17,267", 50, 10],
    ]);
  });

  test("reports a usage record in an unknown shape, and skips other records", () => {
    const parser = createCodexRolloutParser(initialCodexParserState());
    const broken = {
      timestamp: "2026-11-16T22:21:25.509Z",
      type: "token_usage_record",
      payload: { usage: "x" },
    };
    expect(parser.line(line({ type: "turn_context", payload: { turn_id: 4 } }))).toEqual([]);
    expect(parser.line(line({ ...broken, payload: 3 }))).toBeNull();
    expect(parser.line(line({ type: "response_item", payload: {} }))).toEqual([]);
  });

  test("counts a subagent thread under its root session", () => {
    const units = parse([
      meta("0.121.0", { id: "child", parent_thread_id: "root-thread" }),
      turn("t1"),
      tokenCount(usage(10, 0, 1), usage(10, 0, 1)),
    ]);
    expect(units[0]?.session).toBe("root-thread");
  });

  const started = (turnId: string) => ({
    timestamp: at("21:19"),
    type: "event_msg",
    payload: { type: "task_started", turn_id: turnId },
  });
  const ended = (turnId: string) => ({
    timestamp: at("23:00"),
    type: "event_msg",
    payload: { type: "task_complete", turn_id: turnId },
  });
  const item = (time: string, payload: ItemFixture) => ({
    timestamp: at(time),
    type: "response_item",
    payload,
  });
  const answer = (time: string) =>
    item(time, { type: "message", id: "msg_1", role: "assistant", content: [] });

  test("counts a turn with model output and without usage records as one unmeasured request", () => {
    const units = parse([
      meta("0.169.0", { id: "thread" }),
      started("t1"),
      turn("t1"),
      item("21:20", { type: "message", role: "user", content: [] }),
      item("21:21", { type: "reasoning", id: "rs_1", encrypted_content: "x" }),
      answer("21:22"),
      ended("t1"),
    ]);
    expect(units).toEqual([
      {
        identity: "turn:t1:0",
        occurredAtMs: Date.parse(at("21:21")),
        session: "thread",
        provider: "openai",
        model: "gpt-6.1-sol",
        project: "/repo/sub",
        serviceTier: null,
        tokens: null,
      },
    ]);
  });

  test("adds no request for a turn with a usage record or without model output", () => {
    const units = parse([
      meta("0.169.0"),
      started("t1"),
      turn("t1"),
      answer("21:22"),
      record("resp_1"),
      ended("t1"),
      started("t2"),
      turn("t2"),
      // Codex writes this note itself, without an item ID.
      item("22:00", { type: "message", role: "assistant", content: [] }),
      started("t3"),
    ]);
    expect(units.map((unit) => unit.identity)).toEqual(["resp_1"]);
  });

  test("closes a turn without an end when the next turn starts", () => {
    const units = parse([
      meta("0.169.0"),
      started("t1"),
      turn("t1"),
      answer("21:22"),
      started("t2"),
    ]);
    expect(units.map((unit) => [unit.identity, unit.tokens])).toEqual([["turn:t1:0", null]]);
  });

  const toolOutput = (time: string) =>
    item(time, { type: "function_call_output", content: ['"type":"reasoning"'] });

  test("counts each response of a turn: a record covers only its own response", () => {
    const units = parse([
      meta("0.169.0"),
      started("t1"),
      turn("t1"),
      // A response without counts, then one with a record.
      item("21:20", { type: "function_call", id: "fc_1" }),
      toolOutput("21:21"),
      item("21:22", { type: "function_call", id: "fc_2" }),
      record("resp_2"),
      toolOutput("21:23"),
      // A later response without counts, after the record.
      item("59:00", { type: "reasoning", id: "rs_3" }),
      answer("59:01"),
      ended("t1"),
    ]);
    expect(units.map((unit) => [unit.identity, unit.occurredAtMs])).toEqual([
      ["turn:t1:0", Date.parse(at("21:20"))],
      ["resp_2", Date.parse("2026-11-16T22:21:25.509Z")],
      ["turn:t1:2", Date.parse(at("59:00"))],
    ]);
  });

  test("counts output at the end of a read as provisional", () => {
    const parser = createCodexRolloutParser(initialCodexParserState());
    for (const entry of [meta("0.169.0"), started("t1"), turn("t1"), answer("21:22")])
      parser.line(line(entry));
    const finished = parser.finish();
    expect(finished.provisional).toBe(true);
    expect(finished.units?.map((unit) => unit.identity)).toEqual(["turn:t1:0"]);
  });

  test("reports a cut model item as malformed when no record covers it", () => {
    const parser = createCodexRolloutParser(initialCodexParserState());
    for (const entry of [meta("0.169.0"), started("t1"), turn("t1")]) parser.line(line(entry));
    // The cut falls in the content, after the ID and the role.
    const cut = line(answer("21:22")).subarray(0, 130);
    expect(parser.line(cut)).toEqual([]);
    expect(parser.finish().units).toBeNull();
  });

  test("skips copied output before the boundary, but counts own usage records there", () => {
    const copied = (ordinal: number, entry: RolloutFixture): RolloutFixture => ({
      timestamp: entry.timestamp ?? at("21:00"),
      ordinal,
      type: entry.type,
      payload: entry.payload,
    });
    const units = parse([
      copied(0, {
        timestamp: at("21:00"),
        type: "session_meta",
        payload: {
          id: "child",
          session_id: "root",
          cli_version: "0.169.0",
          subagent_history_start_ordinal: 7,
        },
      }),
      copied(1, started("parent-turn")),
      copied(2, turn("parent-turn")),
      // Output without a record can be the parent's: no evidence of a request.
      copied(3, answer("21:01")),
      // A guardian subagent keeps its own measured history before the boundary.
      copied(4, record("resp_0", "child")),
      // A record of another thread is a copy that the other thread counts.
      copied(5, record("resp_parent", "parent")),
      copied(6, ended("parent-turn")),
      copied(7, started("t1")),
      copied(8, turn("t1")),
      copied(9, answer("21:22")),
      copied(10, record("resp_1", "child")),
      copied(11, ended("t1")),
    ]);
    expect(units.map((unit) => [unit.identity, unit.model])).toEqual([
      ["resp_0", "gpt-6.1-sol"],
      ["resp_1", "gpt-6.1-sol"],
    ]);
  });

  const reviewExit = (paginated: boolean): RolloutFixture =>
    paginated
      ? {
          timestamp: at("30:00"),
          type: "event_msg",
          payload: {
            type: "item_completed",
            thread_id: "thread",
            turn_id: "t1",
            item: { type: "ExitedReviewMode", id: "item-1" },
          },
        }
      : { timestamp: at("30:00"), type: "event_msg", payload: { type: "exited_review_mode" } };

  test("skips the note that Codex writes at the end of a review", () => {
    for (const paginated of [true, false]) {
      const units = parse([
        meta("0.169.0"),
        started("t1"),
        turn("t1"),
        item("29:59", { type: "message", role: "user", content: [] }),
        reviewExit(paginated),
        answer("30:01"),
        ended("t1"),
      ]);
      expect(units).toEqual([]);
    }
  });

  test("reports output without a record as unattributed after a copy without a boundary", () => {
    const parser = createCodexRolloutParser(initialCodexParserState());
    const parentMeta = meta("0.120.0", { id: "parent" });
    for (const entry of [meta("0.120.0", { id: "child" }), parentMeta, started("p1"), turn("p1")])
      parser.line(line(entry));
    expect(parser.line(line(answer("21:22")))).toEqual([]);
    expect(parser.line(line(ended("p1")))).toBeNull();
  });

  test("keeps the model and project of the output when later settings change them", () => {
    const units = parse([
      meta("0.169.0"),
      started("t1"),
      turn("t1"),
      answer("21:22"),
      {
        timestamp: at("40:00"),
        type: "event_msg",
        payload: {
          type: "thread_settings_applied",
          thread_settings: { model: "new-model", model_provider_id: "openai", cwd: "/new" },
        },
      },
    ]);
    expect(units.map((unit) => [unit.model, unit.project])).toEqual([["gpt-6.1-sol", "/repo/sub"]]);
  });

  test("takes a new snapshot as the measurement of copied older history in a newer file", () => {
    const units = parse([
      meta("0.169.0"),
      started("old-turn"),
      turn("old-turn"),
      item("21:20", { type: "function_call", id: "fc_1" }),
      item("21:21", { type: "function_call_output" }),
      tokenCount(usage(100, 60, 7), usage(100, 60, 7)),
      // A repeated snapshot measures nothing, so this response has no counts.
      item("21:22", { type: "reasoning", id: "rs_1" }),
      tokenCount(usage(100, 60, 7), usage(100, 60, 7)),
      ended("old-turn"),
    ]);
    expect(units.map((unit) => [unit.identity, unit.tokens])).toEqual([["turn:old-turn:1", null]]);
  });

  test("counts the own output of a copied legacy fork after its own settings", () => {
    const parser = createCodexRolloutParser(initialCodexParserState());
    const ownSettings = {
      timestamp: at("30:00"),
      type: "event_msg",
      payload: {
        type: "thread_settings_applied",
        thread_id: "child",
        thread_settings: { model: "gpt-6.1-sol", model_provider_id: "openai" },
      },
    };
    const entries = [
      meta("0.120.0", { id: "child" }),
      meta("0.120.0", { id: "parent" }),
      started("p1"),
      turn("p1"),
      ended("p1"),
      ownSettings,
      started("t1"),
      turn("t1"),
      answer("31:00"),
      ended("t1"),
    ];
    const units = entries.flatMap((entry) => parser.line(line(entry)) ?? []);
    expect(units.map((unit) => unit.identity)).toEqual(["turn:t1:0"]);
  });

  test("never takes tool data or a review of another turn for a review note", () => {
    const toolItem = {
      timestamp: at("29:00"),
      type: "event_msg",
      payload: {
        type: "item_completed",
        thread_id: "thread",
        turn_id: "t1",
        item: { type: "DynamicToolCall", arguments: { item: { type: "ExitedReviewMode" } } },
      },
    };
    const units = parse([
      meta("0.169.0"),
      started("t1"),
      turn("t1"),
      toolItem,
      answer("29:30"),
      // A review that ends without its note does not hide the next turn.
      reviewExit(true),
      ended("t1"),
      started("t2"),
      turn("t2"),
      answer("31:00"),
      ended("t2"),
    ]);
    expect(units.map((unit) => unit.identity)).toEqual(["turn:t1:0", "turn:t2:0"]);
  });

  test("counts a compaction that sampled the model once, by its response ID", () => {
    // Codex writes resume metadata after the ID. A tool schema there can repeat the key.
    const compacted = (responseId: string | null) => ({
      timestamp: at("35:00"),
      type: "compacted",
      payload: {
        message: "",
        replacement_history: [{ type: "message", role: "user", content: [] }],
        compaction_response_id: responseId,
        resume_metadata: {
          dynamic_tools: [
            { input_schema: { default: { compaction_response_id: "schema-default" } } },
          ],
        },
      },
    });
    const units = parse([
      meta("0.169.0"),
      started("t1"),
      turn("t1"),
      compacted("resp_c"),
      compacted(null),
      ended("t1"),
    ]);
    expect(units.map((unit) => [unit.identity, unit.tokens, unit.session])).toEqual([
      ["resp_c", null, "thread"],
    ]);
    expect(CODEX_USAGE_LINE_FILTER(line(compacted("resp_c")))).toBe(true);
  });
});

describe("CODEX_USAGE_LINE_FILTER", () => {
  const accepts = (entry: RolloutFixture) => CODEX_USAGE_LINE_FILTER(line(entry));

  test("reads types from the start of the line only", () => {
    expect(accepts(record("resp_1"))).toBe(true);
    expect(
      accepts({ timestamp: at("21:21"), type: "response_item", payload: { type: "web_search" } }),
    ).toBe(false);
    expect(
      accepts({ timestamp: at("21:21"), type: "response_item", payload: { type: "reasoning" } }),
    ).toBe(true);
    expect(
      accepts({
        timestamp: at("21:21"),
        type: "event_msg",
        payload: { type: "item_completed", item: { type: "ExitedReviewMode" } },
      }),
    ).toBe(true);
    expect(
      accepts({
        timestamp: at("21:21"),
        type: "event_msg",
        payload: { type: "item_completed", item: { type: "CommandExecution" } },
      }),
    ).toBe(false);
    // Output that quotes a type name is still read as its own type.
    expect(
      accepts({
        timestamp: at("21:21"),
        type: "event_msg",
        payload: { type: "exec_command_end", output: '"type":"token_usage_record"' },
      }),
    ).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { NO_ANSWER_YET_LABEL } from "./replicas/transcript/Answers";
import type { CallData, Row, ToolType } from "./replicas/transcript/model";
import {
  CALL_KINDS,
  type CallKind,
  callKind,
  earlierCallCount,
  LATEST_CALL_COUNT,
  runCounts,
  runTitle,
  showEarlierLabel,
} from "./replicas/transcript/tool-runs";
import { QUESTION_TOOL_NAME } from "./replicas/transcript/ToolRow";
import { storySessions } from "./sample/transcripts";
import { RUNS as CI_RUNS } from "./scenes/ci-checks/sample";
import { CALLS as CONFLICT_CALLS } from "./scenes/git-conflict/sample";
import { GOAL_CALLS } from "./scenes/goal-command/sample";
import { GOAL_TRANSCRIPT } from "./scenes/goal-mode/sample";
import { RUNS as COMMENT_RUNS } from "./scenes/pr-comments/sample";
import { NEXT_CALL, READ_CALLS, SYNC_CALLS } from "./scenes/question/sample";
import { BUILD_CALLS, HELP_SEARCH, KEYMAP_TESTS } from "./scenes/queue/sample";
import { importProduct } from "./test-support/product-source";

/** The counts of a run that the header of tool-runs.ts reads. */
type Summary = { callCount: number; kindCounts: Record<CallKind, number>; fileEditCount: number };

/** The fields of a tool meta that readToolCallName reads. */
type Meta = { tool: string; toolType: ToolType; input: { command?: string } };

// SAFETY: tool-runs.ts exports these values and functions, and a missing export fails the test.
const runs = await importProduct<{
  TOOL_RUN_CALL_KINDS: readonly string[];
  TOOL_RUN_LATEST_CALL_COUNT: number;
  readToolRunCountLabels: (summary: Summary) => string[];
  readToolRunTitle: (summary: Summary) => string;
  readEarlierCalls: (callCount: number, keptHidden: undefined) => { earlierCallCount: number };
  readShowEarlierCallsLabel: (earlierCallCount: number) => string;
}>("packages/frontend-core/src/sessions/transcript/tool-runs.ts");
// SAFETY: agent-chat-tool-presentation.ts exports these, and a missing export fails the test.
const presentation = await importProduct<{
  readToolCallName: (meta: Meta, displayName: string) => string;
  NO_ANSWER_YET_LABEL: string;
}>("packages/frontend-core/src/sessions/messages/agent-chat-tool-presentation.ts");
// SAFETY: format-agent-duration.ts exports this function, and a missing export fails the test.
const { formatAgentDuration } = await importProduct<{
  formatAgentDuration: (durationMs: number) => string;
}>("packages/frontend-core/src/sessions/transcript/format-agent-duration.ts");
// SAFETY: plural.ts exports this function, and a missing export fails the test.
const { plural } = await importProduct<{ plural: (count: number, word: string) => string }>(
  "packages/frontend-core/src/lib/plural.ts",
);

/** The rows of every sample transcript of the story and of the goal mode scene. */
const ROWS: readonly Row[] = [
  ...storySessions([
    { id: "spec", turns: 1 },
    { id: "planner", turns: 1 },
    { id: "qa", turns: 1 },
    { id: "build", turns: 4 },
  ]),
  GOAL_TRANSCRIPT,
].flatMap((session) => session.turns.flatMap((turn) => turn.rows));

/** The consecutive calls of `rows`, as the transcript groups them in tool runs. */
function runsOf(rows: readonly Row[]): CallData[][] {
  const groups: CallData[][] = [];
  let current: CallData[] = [];
  for (const row of rows) {
    if (row.kind === "call") {
      current.push(row);
      continue;
    }
    if (current.length > 0) groups.push(current);
    current = [];
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Each tool run of the samples. */
const RUNS: readonly (readonly CallData[])[] = [
  ...runsOf(ROWS),
  ...Object.values(CI_RUNS),
  ...Object.values(COMMENT_RUNS),
  CONFLICT_CALLS,
  GOAL_CALLS,
  READ_CALLS,
  SYNC_CALLS,
  [NEXT_CALL],
  BUILD_CALLS,
  [KEYMAP_TESTS],
  [HELP_SEARCH],
];

const CALLS = RUNS.flat();

function summaryOf(kinds: readonly CallKind[]): Summary {
  const kindCounts = { command: 0, read: 0, list: 0, search: 0, edit: 0, web: 0, tool: 0 };
  for (const kind of kinds) kindCounts[kind] += 1;
  // Each file edit of the samples changes one file.
  return { callCount: kinds.length, kindCounts, fileEditCount: kindCounts.edit };
}

/** The milliseconds of a duration as formatAgentDuration writes it, such as 2.4s or 1m48s. */
function millisecondsOf(text: string): number {
  const parts = /^(?:(\d+)ms|(\d+(?:\.\d)?)s|(\d+)m(?:(\d+)s)?)$/.exec(text);
  if (!parts) throw new Error(`${text} is not a duration of the app.`);
  const [, ms, seconds, minutes, rest] = parts;
  if (ms) return Number(ms);
  if (seconds) return Number(seconds) * 1000;
  return (Number(minutes) * 60 + Number(rest ?? 0)) * 1000;
}

describe("the tool runs copied from the app", () => {
  test("the header of each run, as its calls join it, has the title and the counts of the app", () => {
    for (const run of RUNS) {
      const kinds = run.map(callKind);
      for (let count = 1; count <= kinds.length; count += 1) {
        const summary = summaryOf(kinds.slice(0, count));
        expect<string>(runTitle(kinds.slice(0, count))).toBe(runs.readToolRunTitle(summary));
        expect(runCounts(kinds.slice(0, count))).toBe(
          runs.readToolRunCountLabels(summary).join(" · "),
        );
      }
    }
  });

  test("a long run hides its earlier calls under the bar of the app", () => {
    expect<readonly string[]>(CALL_KINDS).toEqual(runs.TOOL_RUN_CALL_KINDS);
    expect(LATEST_CALL_COUNT).toBe(runs.TOOL_RUN_LATEST_CALL_COUNT);
    for (let count = 1; count <= 60; count += 1) {
      const earlier = runs.readEarlierCalls(count, undefined).earlierCallCount;
      expect(earlierCallCount(count)).toBe(earlier);
      if (earlier > 0)
        expect(showEarlierLabel(earlier)).toBe(runs.readShowEarlierCallsLabel(earlier));
    }
  });

  test("each call shows the name that the app gives to its tool", () => {
    for (const call of CALLS) {
      const meta: Meta = {
        tool: call.name,
        toolType: call.tool,
        input: call.command === undefined ? {} : { command: call.command },
      };
      expect(presentation.readToolCallName(meta, call.name)).toBe(call.name);
    }
    const question: Meta = { tool: "request_user_input", toolType: "question", input: {} };
    expect(presentation.readToolCallName(question, "request_user_input")).toBe(QUESTION_TOOL_NAME);
  });

  test("a question tool shows the count of its questions and No answer yet", () => {
    for (const row of ROWS) {
      if (row.kind !== "question" || row.answers.length < 2) continue;
      expect(row.summary).toBe(plural(row.answers.length, "question"));
    }
    expect(NO_ANSWER_YET_LABEL).toBe(presentation.NO_ANSWER_YET_LABEL);
  });

  test("each duration of a call and of a turn reads as the app writes it", () => {
    const durations = [
      ...CALLS.map((call) => call.duration),
      ...ROWS.flatMap((row) => {
        if (row.kind === "agent") return row.worked === undefined ? [] : [row.worked];
        return "duration" in row ? [row.duration] : [];
      }),
    ];
    for (const duration of durations) {
      expect(formatAgentDuration(millisecondsOf(duration))).toBe(duration);
    }
  });
});

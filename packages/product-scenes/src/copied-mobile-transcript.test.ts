import { describe, expect, test } from "bun:test";
import * as lucide from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { QUESTION_ROW_ICONS } from "./replicas/mobile/QuestionToolRow";
import { type MobileCall, moreLinesText, TOOL_ICONS } from "./replicas/mobile/ToolRun";
import { ICON_SWAP_IN } from "./replicas/mobile/icon-swap";
import { FOLD_MOTION } from "./replicas/mobile/tool-runs";
import { PHONE_TEXT_UPDATE } from "./replicas/transcript/rows";
import { BUILDER_TOOLS } from "./sample/mobile";
import * as review from "./sample/mobile-review";
import * as diffComment from "./scenes/mobile-diff-comment/sample";
import * as needsYou from "./scenes/mobile-needs-you/sample";
import * as pullRequest from "./scenes/mobile-pull-request/sample";
import * as question from "./scenes/mobile-question/sample";
import * as startBuilder from "./scenes/mobile-start-builder/sample";
import * as steer from "./scenes/mobile-steer/sample";
import { lucideName } from "./test-support/lucide-name";
import { importProduct, readProduct } from "./test-support/product-source";

type ToolMeta = {
  kind: "tool";
  partId: string;
  callId: string;
  tool: string;
  toolType: string;
  status: "completed";
  input: { command: string };
};
type ToolRow = { kind: "message"; key: string; message: { meta: ToolMeta } };
/** A question tool call, as the Codex adapter reports request_user_input. */
type QuestionMeta = Omit<ToolMeta, "input" | "status"> & {
  status: "running" | "completed";
  input: { questions: readonly Omit<typeof question.QUESTION, "answer">[] };
  output?: string;
};
type QuestionDetail = { detail: { prompt: string; answers: string[] } };
type ToolCallPresentation = { kind: string; displayName: string };
type PresentToolCall = (tool: string, label?: string) => ToolCallPresentation;
type CallLine = { kind: string; name: string; text?: string; extraLineCount?: number };
/** A call of a sample run, with its id. */
type SampleCall = { id: string; call: MobileCall };

// SAFETY: tool-runs.ts exports these values and functions.
const runs = await importProduct<{
  readToolRunClassifier: (
    present: PresentToolCall,
  ) => (meta: ToolMeta | QuestionMeta) => string | null;
  readToolRunCallLine: (
    row: ToolRow,
    present: PresentToolCall,
    workingDirectory: string | null,
  ) => CallLine;
}>("packages/frontend-core/src/sessions/transcript/tool-runs.ts");
// SAFETY: agent-chat-tool-presentation.ts exports these values and functions.
const presentation = await importProduct<{
  resolveRegularToolSummary: (
    meta: QuestionMeta,
    content: string,
    workingDirectory: string | null,
  ) => { text: string };
  readQuestionAnswerEntries: (meta: QuestionMeta) => QuestionDetail[];
  readQuestionAnswerText: (detail: QuestionDetail["detail"]) => string;
}>("packages/frontend-core/src/sessions/messages/agent-chat-tool-presentation.ts");
// SAFETY: agent-chat-runtime-presentation.ts exports this function.
const { resolveAgentChatRuntimePresentation } = await importProduct<{
  resolveAgentChatRuntimePresentation: (input: {
    runtimeDefinitions: readonly never[];
    runtimeKind: null;
  }) => { presentToolCall: PresentToolCall };
}>("packages/frontend-core/src/sessions/send/agent-chat-runtime-presentation.ts");
// SAFETY: the transcript fixtures of frontend-core export this function.
const { buildMessage } = await importProduct<{
  buildMessage: (
    role: "tool",
    content: string,
    overrides: { id: string; meta: ToolMeta },
  ) => {
    meta: ToolMeta;
  };
}>("packages/frontend-core/src/test-support/agent-chat-transcript-fixtures.ts");
// SAFETY: plural.ts exports this function.
const { plural } = await importProduct<{ plural: (count: number, word: string) => string }>(
  "packages/frontend-core/src/lib/plural.ts",
);
// SAFETY: format-agent-duration.ts exports these functions.
const durations = await importProduct<{
  formatAgentDuration: (durationMs: number) => string;
  formatTurnDurationLabel: (durationMs: number) => string;
}>("packages/frontend-core/src/sessions/transcript/format-agent-duration.ts");
// SAFETY: these modules of the mobile app import no React Native code.
const { toolIcon } = await importProduct<{
  toolIcon: (meta: { tool: string; toolType: string }) => string;
}>("apps/mobile/src/features/session/transcript/rows/tool-icon.ts");
const { ICONS } = await importProduct<{ ICONS: Record<string, string> }>(
  "apps/mobile/src/ui/icon-names.ts",
);
const { FOLD_MOTION_MS } = await importProduct<{ FOLD_MOTION_MS: number }>(
  "apps/mobile/src/features/session/transcript/transcript-fold-motion.ts",
);

const { presentToolCall } = resolveAgentChatRuntimePresentation({
  runtimeDefinitions: [],
  runtimeKind: null,
});
const classify = runs.readToolRunClassifier(presentToolCall);

/**
 * The transcript row of a sample call, as the Codex adapter reports a command: the tool is the
 * action of the command, such as `read`, and the input holds the command.
 */
const rowOf = (id: string, call: MobileCall): ToolRow => ({
  kind: "message",
  key: `row:${id}`,
  message: buildMessage("tool", "", {
    id,
    meta: {
      kind: "tool",
      partId: `${id}-part`,
      callId: `${id}-call`,
      tool: call.type,
      toolType: call.type,
      status: "completed",
      input: { command: call.text },
    },
  }),
});

/** The calls `ids` of the sample `tools`, in order. */
const callsOf = <Id extends string>(
  tools: Readonly<Record<Id, MobileCall>>,
  ids: readonly Id[],
): SampleCall[] => ids.map((id) => ({ id, call: tools[id] }));

/** The runs of the samples, with their calls. */
const SAMPLE_RUNS: readonly SampleCall[][] = [
  ...Object.values(needsYou.RUNS).map((ids) => callsOf(needsYou.TOOLS, ids)),
  ...Object.values(question.RUNS).map((ids) => callsOf(question.TOOLS, ids)),
  ...Object.values(steer.RUNS).map((ids) => callsOf(steer.TOOLS, ids)),
  ...Object.values(diffComment.RUNS).map((ids) => callsOf(diffComment.TOOLS, ids)),
  ...Object.values(startBuilder.RUNS).map((ids) => callsOf(startBuilder.TOOLS, ids)),
  callsOf(review.FIX_TOOLS, review.FIX_RUN),
  ...Object.values(pullRequest.RUNS).map((ids) => callsOf(pullRequest.TOOLS, ids)),
];

/** The milliseconds of a duration label, such as 2.4s, 180ms, or 1m13s. */
const milliseconds = (label: string): number => {
  const match = /^(?:(\d+)m)?(?:(\d+(?:\.\d+)?)(ms|s))?$/.exec(label);
  if (!match || label.length === 0) throw new Error(`${label} is not a duration.`);
  const [, minutes = "0", amount = "0", unit = "s"] = match;
  return Number(minutes) * 60_000 + Number(amount) * (unit === "ms" ? 1 : 1_000);
};

/**
 * The question tool call of the question scene, while it waits and with the answer. Codex sends
 * the questions without their answers, and the answers come in the output of the call.
 */
const questionMeta = (answered: boolean): QuestionMeta => {
  const { answer, ...asked } = question.QUESTION;
  const meta: QuestionMeta = {
    kind: "tool",
    partId: "question-part",
    callId: "question-call",
    tool: "request_user_input",
    toolType: "question",
    status: answered ? "completed" : "running",
    input: { questions: [asked] },
  };
  if (answered) meta.output = JSON.stringify({ answers: [[answer]] });
  return meta;
};

/** The lucide-react name of the Lucide icon `name`, such as CircleCheck for circle-check. */
const componentName = (name: string | undefined): string =>
  (name ?? "")
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");

/** The names that lucide-react exports `Icon` under, such as CircleHelp and CircleQuestionMark. */
const exportNames = (Icon: LucideIcon): string[] =>
  Object.entries(lucide).flatMap(([name, value]) => (value === Icon ? [name] : []));

describe("the transcript of the mobile app copied in the replicas", () => {
  test("a Codex command shows as bash with its command and the icon of its action", () => {
    for (const { id, call } of SAMPLE_RUNS.flat()) {
      const row = rowOf(id, call);
      expect(classify(row.message.meta)).toBe(call.kind);
      const line = runs.readToolRunCallLine(row, presentToolCall, null);
      // A command of more than one line shows its first line and the count of the others.
      const [first, ...others] = call.text.split("\n");
      expect([line.kind, line.name, line.text]).toEqual(["command", call.name, first]);
      expect(line.extraLineCount).toBe(others.length);
      if (others.length > 0) {
        expect(moreLinesText(others.length)).toBe(`+${plural(others.length, "line")}`);
      }
    }
    for (const [type, icon] of Object.entries(TOOL_ICONS)) {
      expect(lucideName(icon.displayName)).toBe(
        ICONS[toolIcon({ tool: type, toolType: type })] ?? "",
      );
    }
  });

  test("the calls and the turns show their times as the app formats them", () => {
    const calls = [...SAMPLE_RUNS.flat().map(({ call }) => call), ...Object.values(BUILDER_TOOLS)];
    for (const { duration } of [...calls, pullRequest.SET_PULL_REQUEST, question.QUESTION_CALL]) {
      expect(durations.formatAgentDuration(milliseconds(duration))).toBe(duration);
    }
    for (const worked of [diffComment.WORKED, review.FIX_WORKED, pullRequest.WORKED]) {
      expect(durations.formatTurnDurationLabel(milliseconds(worked))).toBe(`Worked for ${worked}`);
    }
  });

  test("a question shows alone with its question and its answer as the app does", () => {
    const waiting = questionMeta(false);
    const answered = questionMeta(true);
    expect(classify(answered)).toBeNull();
    expect(presentation.resolveRegularToolSummary(answered, "", null).text).toBe(
      question.QUESTION.question,
    );
    const answerOf = (meta: QuestionMeta): string[] =>
      presentation
        .readQuestionAnswerEntries(meta)
        .map(({ detail }) => presentation.readQuestionAnswerText(detail));
    expect(answerOf(waiting)).toEqual([""]);
    expect(answerOf(answered)).toEqual([question.QUESTION.answer]);
    expect(toolIcon(answered)).toBe("circle-help");
    for (const [name, Icon] of Object.entries(QUESTION_ROW_ICONS)) {
      expect(exportNames(Icon)).toContain(componentName(ICONS[name]));
    }
  });

  test("a tool run opens and folds in the time of the app", () => {
    expect(FOLD_MOTION * 1_000).toBe(FOLD_MOTION_MS);
  });

  test("a call that ends grows its icon in as the app does", async () => {
    const status = await readProduct(
      "apps/mobile/src/features/session/transcript/rows/tool-status.tsx",
    );
    expect(status).toContain(
      `animationName: { from: { opacity: 0, transform: [{ scale: ${ICON_SWAP_IN.scale} }] } },\n  animationDuration: ${ICON_SWAP_IN.duration * 1_000},`,
    );
  });

  test("a message streams in the updates of the app", async () => {
    // SAFETY: session-event-batching.ts exports this value.
    const { TEXT_STREAM_INTERVAL_MS } = await importProduct<{ TEXT_STREAM_INTERVAL_MS: number }>(
      "packages/frontend-core/src/sessions/agent-orchestrator/events/session-event-batching.ts",
    );
    expect(PHONE_TEXT_UPDATE * 1_000).toBe(TEXT_STREAM_INTERVAL_MS);
  });
});

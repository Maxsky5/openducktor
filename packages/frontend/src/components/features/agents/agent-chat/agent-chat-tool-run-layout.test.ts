import { describe, expect, test } from "bun:test";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { resolveAgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat-runtime-presentation";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import {
  groupToolRuns,
  readToolRunClassifier,
} from "@openducktor/frontend-core/sessions/transcript/tool-runs";
import { buildMessage } from "@openducktor/frontend-core/test-support/agent-chat-transcript-fixtures";
import {
  buildToolRunItems,
  buildToolRunWindowRows,
  buildTurnItems,
  foldUserMessageAnchors,
  type ToolRunFolds,
} from "./agent-chat-tool-run-layout";

const classify = readToolRunClassifier(
  resolveAgentChatRuntimePresentation({ runtimeDefinitions: [], runtimeKind: null })
    .presentToolCall,
);

const NO_FOLDS: ToolRunFolds = { choices: new Map(), keptHidden: new Map() };

const messageRow = (role: "user" | "assistant", id: string): AgentChatTranscriptRow => ({
  kind: "message",
  key: `row:${id}`,
  message: buildMessage(role, id, { id }),
});

const shellRow = (
  id: string,
  status: ToolMeta["status"] = "completed",
): AgentChatTranscriptRow => ({
  kind: "message",
  key: `row:${id}`,
  message: buildMessage("tool", `Tool ${id}`, {
    id,
    meta: {
      kind: "tool",
      partId: `${id}-part`,
      callId: `${id}-call`,
      tool: "bash",
      toolType: "bash",
      status,
      input: { command: `echo ${id}` },
    },
  }),
});

const windowRowsOf = (rows: AgentChatTranscriptRow[]) =>
  buildToolRunWindowRows(rows, groupToolRuns(rows, classify));

const itemsOf = (
  rows: AgentChatTranscriptRow[],
  folds: ToolRunFolds = NO_FOLDS,
  collapseFinishedRuns = false,
) => {
  const windowRows = windowRowsOf(rows);
  return buildTurnItems(windowRows.rows, windowRows, folds, collapseFinishedRuns);
};

const keys = (rows: readonly AgentChatTranscriptRow[]) => rows.map((row) => row.key);

describe("buildToolRunWindowRows", () => {
  const rows = [
    messageRow("user", "ask"),
    shellRow("one"),
    shellRow("two", "error"),
    shellRow("three"),
    messageRow("assistant", "answer"),
    messageRow("user", "again"),
    shellRow("four"),
  ];

  test("gives the row window the first row of each run", () => {
    const windowRows = windowRowsOf(rows);

    expect(keys(windowRows.rows)).toEqual([
      "row:ask",
      "row:one",
      "row:answer",
      "row:again",
      "row:four",
    ]);
    expect([...windowRows.runs.keys()]).toEqual(["row:one", "row:four"]);
    expect(windowRows.layoutKey).toBe("1:2");
  });

  test("settles a run whose calls all ended and that another row follows", () => {
    const running = [...rows.slice(0, 3), shellRow("three", "running"), ...rows.slice(4)];

    expect([...windowRowsOf(rows).settledRunKeys]).toEqual(["row:one"]);
    expect([...windowRowsOf(running).settledRunKeys]).toEqual([]);
  });

  test("keeps the rows of a transcript whose runs hide no row", () => {
    const single = [messageRow("user", "ask"), shellRow("one"), messageRow("assistant", "answer")];

    expect(windowRowsOf(single)).toMatchObject({ rows: single, layoutKey: "" });
  });

  test("moves the user message anchors above the hidden rows", () => {
    const anchors = [
      { rowKey: "row:ask", rowIndex: 0, message: buildMessage("user", "ask") },
      { rowKey: "row:again", rowIndex: 5, message: buildMessage("user", "again") },
    ];
    const { layoutKey } = windowRowsOf(rows);

    expect(foldUserMessageAnchors(anchors, layoutKey).map((anchor) => anchor.rowIndex)).toEqual([
      0, 3,
    ]);
    expect(foldUserMessageAnchors(anchors, "")).toBe(anchors);
  });
});

describe("buildTurnItems", () => {
  const settled = [shellRow("one"), shellRow("two", "error"), messageRow("assistant", "answer")];

  test("gives each run with the counts of all its calls", () => {
    const [item] = itemsOf(settled);

    expect(item).toMatchObject({
      kind: "tool_run",
      key: "row:one:tool-run",
      folded: false,
      callCount: 2,
      failedCount: 1,
    });
  });

  test("folds a finished run that another row follows, unless the reader opened it", () => {
    expect(itemsOf(settled, NO_FOLDS, true)[0]).toMatchObject({ folded: true });
    const opened = { choices: new Map([["row:one", "open" as const]]), keptHidden: new Map() };
    expect(itemsOf(settled, opened, true)[0]).toMatchObject({ folded: false });

    // A run that still runs, or that ends the transcript, stays open.
    expect(
      itemsOf([shellRow("one", "running"), messageRow("assistant", "answer")], NO_FOLDS, true)[0],
    ).toMatchObject({ folded: false });
    expect(itemsOf([shellRow("one")], NO_FOLDS, true)[0]).toMatchObject({ folded: false });
  });

  test("keeps a run folded that the reader folded", () => {
    const folded = { choices: new Map([["row:one", "folded" as const]]), keptHidden: new Map() };

    expect(itemsOf([shellRow("one", "running")], folded)[0]).toMatchObject({ folded: true });
  });

  test("shows the latest calls of a long run until the reader shows the earlier ones", () => {
    const long = Array.from({ length: 9 }, (_, index) =>
      shellRow(`call${index}`, index === 1 ? "error" : "completed"),
    );

    expect(itemsOf(long)[0]).toMatchObject({
      callCount: 9,
      earlierCallCount: 4,
      shownEarlierCount: 0,
      earlierFailedCount: 1,
    });
    const shownAll = { choices: new Map(), keptHidden: new Map([["row:call0", 0]]) };
    expect(itemsOf(long, shownAll)[0]).toMatchObject({ earlierCallCount: 0, shownEarlierCount: 4 });

    // New calls keep the shown calls shown.
    const paging = { choices: new Map(), keptHidden: new Map([["row:call0", 2]]) };
    const grown = [...long, shellRow("call9")];
    expect(itemsOf(grown, paging)[0]).toMatchObject({ earlierCallCount: 2, shownEarlierCount: 3 });
  });

  test("keeps the item of a run while the run and its folds do not change", () => {
    const rows = [shellRow("one"), shellRow("two")];
    const windowRows = windowRowsOf(rows);
    const [item] = buildTurnItems(windowRows.rows, windowRows, NO_FOLDS, false);

    expect(buildTurnItems(windowRows.rows, windowRows, NO_FOLDS, false)[0]).toBe(item);
    const folded = { choices: new Map([["row:one", "folded" as const]]), keptHidden: new Map() };
    expect(buildTurnItems(windowRows.rows, windowRows, folded, false)[0]).not.toBe(item);
  });

  test("keeps the rows that no run holds as their own items", () => {
    const rows = [
      messageRow("assistant", "intro"),
      shellRow("inside"),
      messageRow("assistant", "outro"),
    ];

    expect(buildToolRunItems(rows, classify).map((item) => item.key)).toEqual([
      "row:intro",
      "row:inside:tool-run",
      "row:outro",
    ]);
  });
});

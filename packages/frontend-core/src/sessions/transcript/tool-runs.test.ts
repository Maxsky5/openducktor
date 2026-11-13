import { describe, expect, test } from "bun:test";
import type { ToolMeta } from "../messages/agent-chat-message-card-model.types";
import type { AgentChatTranscriptRow } from "./agent-chat-transcript-model";
import { buildMessage } from "../../test-support/agent-chat-transcript-fixtures";
import { resolveAgentChatRuntimePresentation } from "../send/agent-chat-runtime-presentation";
import {
  groupToolRuns,
  isToolRunRow,
  NO_TOOL_RUNS,
  readEarlierCalls,
  readEarlierCallStep,
  readHideEarlierCallsLabel,
  readShowEarlierCallsLabel,
  readToolRunCallLine,
  readToolRunClassifier,
  readToolRunCountLabels,
  readToolRunStates,
  readToolRunTitle,
  type ToolRun,
  type ToolRunRow,
  type ToolRunSegment,
} from "./tool-runs";

const presentToolCall = resolveAgentChatRuntimePresentation({
  runtimeDefinitions: [],
  runtimeKind: null,
}).presentToolCall;
const classify = readToolRunClassifier(presentToolCall);

const segmentsOf = (rows: readonly AgentChatTranscriptRow[]): readonly ToolRunSegment[] =>
  groupToolRuns(rows, classify);

const segmentKeys = (rows: readonly AgentChatTranscriptRow[]): string[] =>
  segmentsOf(rows).map((segment) =>
    segment.kind === "row" ? segment.row.key : `${segment.run.runKey}:tool-run`,
  );

const runOf = (rows: readonly AgentChatTranscriptRow[]): ToolRun => {
  const [segment] = segmentsOf(rows);
  if (segment?.kind !== "tool_run") throw new Error("Expected a tool run.");
  return segment.run;
};

const toolRow = (id: string, meta: Partial<ToolMeta>): AgentChatTranscriptRow => ({
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
      status: "completed",
      ...meta,
    },
  }),
});

const shellRow = (id: string, status: ToolMeta["status"] = "completed"): ToolRunRow => {
  const row = toolRow(id, { status, input: { command: `echo ${id}` } });
  if (!isToolRunRow(row, classify)) throw new Error("Expected a shell command row.");
  return row;
};

const textRow = (id: string): AgentChatTranscriptRow => ({
  kind: "message",
  key: `row:${id}`,
  message: buildMessage("assistant", id, { id }),
});

describe("groupToolRuns", () => {
  test("puts each run of consecutive tool run calls in one segment", () => {
    const rows = [
      textRow("intro"),
      shellRow("status"),
      shellRow("lint", "error"),
      toolRow("task", { tool: "odt_set_task_artifact", toolType: "workflow" }),
      shellRow("test", "running"),
      textRow("outro"),
    ];

    const segments = segmentsOf(rows);

    expect(segmentKeys(rows)).toEqual([
      "row:intro",
      "row:status:tool-run",
      "row:task",
      "row:test:tool-run",
      "row:outro",
    ]);
    expect(segments.map((segment) => segment.index)).toEqual([0, 1, 3, 4, 5]);
    const [, first, , second] = segments;
    if (first?.kind !== "tool_run" || second?.kind !== "tool_run") {
      throw new Error("Expected tool runs.");
    }
    expect(first.run.summary).toMatchObject({ callCount: 2, failedCount: 1, activeCount: 0 });
    expect(second.run.summary).toMatchObject({ callCount: 1, failedCount: 0, activeCount: 1 });
  });

  test("groups again only the rows from the first changed row, as a full grouping does", () => {
    // A classifier of its own starts without the groups of the other tests.
    const ownClassify: typeof classify = (meta) => classify(meta);
    const intro = textRow("intro");
    const status = shellRow("status");
    const answer = textRow("answer");
    const before = [intro, status, answer, shellRow("lint"), shellRow("test", "running")];
    const first = groupToolRuns(before, ownClassify);

    const after = [intro, status, answer, before[3]!, shellRow("test"), shellRow("build")];
    const next = groupToolRuns(after, ownClassify);

    expect(next.slice(0, 3)).toEqual(first.slice(0, 3));
    for (const index of [0, 1, 2]) expect(next[index]).toBe(first[index]);
    expect(next).toEqual(groupToolRuns(after, (meta) => classify(meta)));
    expect(next.at(-1)).toMatchObject({ kind: "tool_run", index: 3 });
    // A shorter transcript drops the segments of the rows that it lost.
    expect(groupToolRuns([intro, status], ownClassify)).toEqual(
      groupToolRuns([intro, status], (meta) => classify(meta)),
    );
  });

  test("gives a run the call that comes right after it", () => {
    const ownClassify: typeof classify = (meta) => classify(meta);
    const rows = [textRow("intro"), shellRow("one"), shellRow("two")];
    groupToolRuns(rows, ownClassify);

    const grown = groupToolRuns([...rows, shellRow("three")], ownClassify);

    expect(grown.map((segment) => segment.kind)).toEqual(["row", "tool_run"]);
    expect(grown[1]?.kind === "tool_run" && grown[1].run.rows.length).toBe(3);
  });

  test("keeps the object of a run while its calls do not change", () => {
    const rows = [shellRow("one"), shellRow("two")];
    const run = runOf(rows);

    expect(runOf([...rows])).toBe(run);
    const grown = runOf([...rows, shellRow("three")]);
    expect(grown).not.toBe(run);
    expect(grown.runKey).toBe(run.runKey);
    expect(grown.summary.callCount).toBe(3);
  });

  test("counts a declined call as cancelled, not as failed", () => {
    const declined = toolRow("rm", {
      status: "error",
      input: { command: "rm -rf build" },
      error: "The command was declined.",
    });
    expect(runOf([shellRow("lint", "error"), declined]).summary).toMatchObject({
      callCount: 2,
      failedCount: 1,
      cancelledCount: 1,
    });
  });

  test("keeps the file lookups and the tool calls between commands in their run", () => {
    const rows = [
      shellRow("status"),
      toolRow("read", { tool: "read", toolType: "read", input: { filePath: "a.ts" } }),
      toolRow("grep", { tool: "Grep", toolType: "search", input: { pattern: "foo" } }),
      toolRow("ls", { tool: "list", toolType: "list", input: { path: "src" } }),
      toolRow("semble", { tool: "mcp__semble__search", toolType: "search" }),
      shellRow("test"),
    ];

    expect(segmentKeys(rows)).toEqual(["row:status:tool-run"]);
    const { summary } = runOf(rows);
    expect(readToolRunCountLabels(summary)).toEqual([
      "2 commands",
      "1 read",
      "1 list",
      "1 search",
      "1 tool call",
    ]);
    expect(readToolRunTitle(summary)).toBe("Tools");
  });

  test("leaves the calls with their own display out of the runs", () => {
    const rows = [
      toolRow("artifact", { tool: "odt_set_task_artifact", toolType: "workflow" }),
      toolRow("browser", { tool: "odt_browser_click", toolType: "generic" }),
      toolRow("event", { tool: "odt_apply_workflow_event", toolType: "workflow" }),
      toolRow("ask", { tool: "AskUserQuestion", toolType: "question" }),
      toolRow("todo", { tool: "TodoWrite", toolType: "todo" }),
      toolRow("screen", { tool: "computer", toolType: "computer_use" }),
    ];

    expect(segmentsOf(rows).map((segment) => segment.kind)).toEqual(Array(6).fill("row"));
  });

  test("puts the ODT tools that read tasks in runs, with the summary of their rows", () => {
    const search = toolRow("search", {
      tool: "odt_search_tasks",
      toolType: "workflow",
      status: "running",
      input: { title: "Facebook", limit: 50 },
    });
    const rows = [
      toolRow("read", { tool: "odt_read_task", toolType: "workflow", input: { taskId: "t-1" } }),
      toolRow("artifacts", { tool: "openducktor_odt_read_task_artifacts", toolType: "workflow" }),
      toolRow("assets", { tool: "mcp__openducktor__odt_read_task_assets", toolType: "workflow" }),
      search,
    ];

    expect(runOf(rows).summary).toMatchObject({ callCount: 4, kindCounts: { tool: 4 } });
    if (!isToolRunRow(search, classify)) throw new Error("Expected a tool run row.");
    expect(readToolRunCallLine(search, presentToolCall, null)).toEqual({
      kind: "call",
      name: "search_tasks",
      toolName: "search_tasks",
      isMuted: false,
      summary: "title: Facebook · limit: 50",
      isPath: false,
      filePath: null,
      changes: null,
      errorPreview: null,
    });
  });

  test("puts file edits in runs, and gives their path and changes", () => {
    const edit = toolRow("edit", {
      tool: "edit",
      toolType: "file_edit",
      input: { filePath: "/repo/src/a.ts", oldString: "one", newString: "two\nthree" },
    });
    const { summary } = runOf([shellRow("status"), edit]);

    expect(summary).toMatchObject({ kindCounts: { command: 1, edit: 1 } });
    expect(readToolRunCountLabels(summary)).toEqual(["1 command", "1 edit"]);
    if (!isToolRunRow(edit, classify)) throw new Error("Expected a tool run row.");
    expect(readToolRunCallLine(edit, presentToolCall, "/repo")).toMatchObject({
      kind: "call",
      name: "edit",
      summary: "src/a.ts",
      isPath: true,
      filePath: "src/a.ts",
    });
    // An edit alone makes a run of one, so the next call joins its run.
    expect(segmentsOf([edit]).map((segment) => segment.kind)).toEqual(["tool_run"]);
  });

  test("gives the first line of a command, or a note while the agent writes it", () => {
    const command = toolRow("multi", {
      status: "error",
      input: { command: "./node_modules/.bin/vitest run\nbun test" },
      error: "Tests failed",
    });
    const preparing = toolRow("empty", { status: "pending", input: {} });
    if (!isToolRunRow(command, classify) || !isToolRunRow(preparing, classify)) {
      throw new Error("Expected tool run rows.");
    }

    expect(readToolRunCallLine(command, presentToolCall, null)).toMatchObject({
      kind: "command",
      text: "vitest run",
      isPreparing: false,
      isMuted: false,
      extraLineCount: 1,
      errorPreview: "Tests failed",
    });
    expect(readToolRunCallLine(preparing, presentToolCall, null)).toMatchObject({
      kind: "command",
      text: "Preparing the command",
      isPreparing: true,
      isMuted: true,
    });
  });

  test("shows the path of a file lookup and the query of an MCP search in their own fonts", () => {
    const glob = toolRow("glob", {
      tool: "glob",
      toolType: "search",
      input: { pattern: "**/*.ts" },
    });
    const semble = toolRow("semble", {
      tool: "mcp__semble__search",
      toolType: "search",
      input: { query: "tool runs" },
    });
    if (!isToolRunRow(glob, classify) || !isToolRunRow(semble, classify)) {
      throw new Error("Expected tool run rows.");
    }

    expect(readToolRunCallLine(glob, presentToolCall, null)).toMatchObject({ isPath: true });
    expect(readToolRunCallLine(semble, presentToolCall, null)).toMatchObject({ isPath: false });
  });

  test("counts each file of a patch as an edit, and names each edit tool edit", () => {
    const fileDiff = (file: string) => ({
      file,
      type: "modified" as const,
      additions: 1,
      deletions: 0,
      diff: "@@ -1 +1,2 @@\n line\n+added\n",
    });
    const patch = toolRow("patch", {
      tool: "apply_patch",
      toolType: "file_edit",
      fileDiffs: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].map((file) => fileDiff(`/repo/${file}`)),
    });
    const write = toolRow("write", {
      tool: "Write",
      toolType: "file_edit",
      input: { file_path: "/repo/f.ts", content: "one" },
    });
    const { summary } = runOf([patch, write]);

    expect(summary).toMatchObject({ callCount: 2, kindCounts: { edit: 2 }, fileEditCount: 6 });
    expect(readToolRunCountLabels(summary)).toEqual(["6 edits"]);
    expect(readToolRunTitle(summary)).toBe("Files");
    if (!isToolRunRow(patch, classify)) throw new Error("Expected a tool run row.");
    // The transcript names the edit, and the details name the tool that the agent called.
    expect(readToolRunCallLine(patch, presentToolCall, "/repo")).toMatchObject({
      name: "edit",
      toolName: "apply_patch",
      summary: "5 files",
    });
  });

  test("says that a run runs only in the header of a folded run", () => {
    const { summary } = runOf([shellRow("lint", "error"), shellRow("test", "running")]);

    expect(readToolRunStates(summary, true).map((state) => state.label)).toEqual([
      "1 failed",
      "Running",
    ]);
    // An open run shows its running call in its line.
    expect(readToolRunStates(summary, false).map((state) => state.label)).toEqual(["1 failed"]);
  });

  test("shows each call as its own row without tool runs", () => {
    const segments = groupToolRuns([shellRow("status"), shellRow("test")], NO_TOOL_RUNS);
    expect(segments.map((segment) => segment.kind)).toEqual(["row", "row"]);
  });

  test("names a run of web searches, of file lookups, and of shell calls", () => {
    const web = (id: string) => toolRow(id, { tool: "WebSearch", toolType: "web" });
    const read = (id: string) => toolRow(id, { tool: "read", toolType: "read" });
    const webRun = runOf([web("one"), web("two")]);
    const fileRun = runOf([read("one"), read("two")]);
    const shellRun = runOf([read("one"), shellRow("two")]);
    expect([
      readToolRunTitle(webRun.summary),
      readToolRunTitle(fileRun.summary),
      readToolRunTitle(shellRun.summary),
    ]).toEqual(["Web", "Files", "Shell"]);
    expect(readToolRunCountLabels(webRun.summary)).toEqual(["2 web searches"]);
  });
});

describe("earlier calls", () => {
  test("shows the earlier calls of a run of hundreds a page at a time", () => {
    expect(readEarlierCalls(300, undefined)).toEqual({
      earlierCallCount: 295,
      shownEarlierCount: 0,
    });
    expect(readEarlierCalls(300, 270)).toEqual({ earlierCallCount: 270, shownEarlierCount: 25 });
    // A run of six calls shows them all.
    expect(readEarlierCalls(6, undefined)).toEqual({ earlierCallCount: 0, shownEarlierCount: 0 });
    expect(readHideEarlierCallsLabel(25)).toBe("Hide 25 earlier calls");
    expect(readShowEarlierCallsLabel(295)).toBe("Show 25 of 295 earlier calls");
    expect(readEarlierCallStep(295)).toBe(25);
    // A page that would leave only a few calls shows them all.
    expect(readEarlierCallStep(30)).toBe(30);
    expect(readShowEarlierCallsLabel(30)).toBe("Show 30 earlier calls");
  });
});

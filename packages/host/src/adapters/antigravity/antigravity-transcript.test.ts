import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import { AntigravityTranscript } from "./antigravity-transcript";

const NOW = "2026-11-21T10:00:00.000Z";

const createTranscript = () =>
  new AntigravityTranscript(
    "session-1",
    (blocks) => ({
      text: blocks.map((block) => (block.type === "text" ? block.text : "")).join(""),
      displayParts: [],
    }),
    () => NOW,
  );

const text = (
  sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk",
  value: string,
): SessionUpdate => ({
  sessionUpdate,
  content: { type: "text", text: value },
});

const turnUpdates: SessionUpdate[] = [
  text("agent_thought_chunk", "Plan "),
  text("agent_thought_chunk", "it"),
  { sessionUpdate: "usage_update", used: 10, size: 100 },
  {
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    title: "ls missing",
    name: "run_command",
    kind: "execute",
    status: "in_progress",
    rawInput: { CommandLine: "ls missing" },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "call-1",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "No such file" } }],
    rawOutput: { output: "No such file", exit_code: 1 },
  },
  text("agent_message_chunk", "Do"),
  text("agent_message_chunk", "ne."),
];

/** The replay merges the chunks of each message and sends the final state of each tool. */
const replayUpdates: SessionUpdate[] = [
  { sessionUpdate: "user_message_chunk", content: { type: "text", text: "List it" } },
  text("agent_thought_chunk", "Plan it"),
  {
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    title: "ls missing",
    name: "run_command",
    kind: "execute",
    status: "completed",
    rawInput: { CommandLine: "ls missing" },
    content: [{ type: "content", content: { type: "text", text: "No such file" } }],
    rawOutput: { output: "No such file", exit_code: 1 },
  },
  text("agent_message_chunk", "Done."),
];

describe("AntigravityTranscript", () => {
  test("gives a live turn and its replay the same history", () => {
    const live = createTranscript();
    live.addLiveUserMessage({ message: { text: "List it", displayParts: [] } });
    for (const update of turnUpdates) live.applyUpdate(update, "live");
    live.finishTurn("completed");

    const replay = createTranscript();
    for (const update of replayUpdates) replay.applyUpdate(update, "replay");
    replay.finishReplay();

    const historyRows = (transcript: AntigravityTranscript) =>
      transcript.history.map((message) => ({
        messageId: message.messageId,
        role: message.role,
        text: message.text,
        parts: message.parts,
      }));
    expect(historyRows(live)).toEqual(historyRows(replay));
    // A replay has no times, so each of its entries has an approximate time. Live times are exact.
    expect(replay.history.every((message) => message.timestampIsApproximate === true)).toBe(true);
    expect(live.history.some((message) => message.timestampIsApproximate)).toBe(false);
    expect(historyRows(live).map((message) => message.messageId)).toEqual([
      "session-1:t1:user",
      "session-1:t1:i1",
      "session-1:tool:call-1",
      "session-1:t1:i3",
    ]);
  });

  test("splits two replayed user messages that have no output between them", () => {
    const replay = createTranscript();
    for (const update of [
      text("user_message_chunk", "/plan"),
      text("user_message_chunk", "Say hi."),
      text("agent_message_chunk", "Hi."),
    ]) {
      replay.applyUpdate(update, "replay");
    }
    replay.finishReplay();

    expect(replay.history.map(({ role, text: body }) => [role, body])).toEqual([
      ["user", "/plan"],
      ["user", "Say hi."],
      ["assistant", "Hi."],
    ]);
  });

  test("replays a /compact message as its compaction notice", () => {
    const replay = createTranscript();
    replay.applyUpdate(text("user_message_chunk", "/compact"), "replay");
    replay.applyUpdate(text("user_message_chunk", "Next"), "replay");
    replay.applyUpdate(text("agent_message_chunk", "Done"), "replay");
    replay.finishReplay();

    expect(replay.history.map(({ role, text: body }) => ({ role, body }))).toEqual([
      { role: "system", body: "Session compacted." },
      { role: "user", body: "Next" },
      { role: "assistant", body: "Done" },
    ]);
    expect(replay.history[0]).toMatchObject({
      messageId: "session-1:t1:user",
      notice: { reason: "session_compacted", title: "Compacted" },
    });
  });

  test("starts a new replayed message when the message after /compact starts with a file", () => {
    const replay = createTranscript();
    replay.applyUpdate(text("user_message_chunk", "/compact"), "replay");
    replay.applyUpdate(
      {
        sessionUpdate: "user_message_chunk",
        content: {
          type: "resource_link",
          uri: pathToFileURL(resolve("/repo/foo.ts")).href,
          name: "foo.ts",
        },
      },
      "replay",
    );
    replay.applyUpdate(text("user_message_chunk", " explain it"), "replay");
    replay.applyUpdate(text("agent_message_chunk", "Done"), "replay");
    replay.finishReplay();

    expect(replay.history.map(({ role, messageId }) => ({ role, messageId }))).toEqual([
      { role: "system", messageId: "session-1:t1:user" },
      { role: "user", messageId: "session-1:t2:user" },
      { role: "assistant", messageId: expect.stringContaining("session-1:t2:") },
    ]);
  });

  test("keeps a replayed slash command and its arguments in one message", () => {
    const replay = createTranscript();
    for (const update of [
      text("user_message_chunk", "/antigravity-guide"),
      text("user_message_chunk", " say ok"),
      text("agent_message_chunk", "ok"),
      text("user_message_chunk", "/plan"),
      text("user_message_chunk", "Say hi."),
    ]) {
      replay.applyUpdate(update, "replay");
    }
    replay.finishReplay();

    expect(replay.history.map(({ role, text: body }) => [role, body])).toEqual([
      ["user", "/antigravity-guide say ok"],
      ["assistant", "ok"],
      ["user", "/plan"],
      ["user", "Say hi."],
    ]);
  });

  test("reports a command that exits with an error code as failed", () => {
    const transcript = createTranscript();
    transcript.addLiveUserMessage({ message: { text: "List it", displayParts: [] } });
    const events = turnUpdates.flatMap((update) => transcript.applyUpdate(update, "live"));

    const tool = events.flatMap((event) =>
      event.type === "assistant_part" && event.part.kind === "tool" ? [event.part] : [],
    );
    expect(tool.at(-1)).toMatchObject({
      status: "error",
      error: "Command exited with code 1.",
      metadata: { exit: 1 },
      toolType: "bash",
      input: { command: "ls missing" },
    });
  });

  test.each([
    {
      call: "an MCP call",
      name: "call_mcp_tool",
      title: "MCP Tool search",
      rawInput: { ServerName: "semble", ToolName: "search", Arguments: { query: "rows" } },
      part: { tool: "semble.search", toolType: "generic", input: { query: "rows" } },
    },
    {
      call: "a background task check",
      name: "manage_task",
      title: "Run manage_task",
      rawInput: { Action: "status", TaskId: "session-1/task-820" },
      part: { tool: "manage_task", toolType: "generic", title: "status task-820" },
    },
    {
      call: "an unknown tool",
      name: "set_timer",
      title: "Run set_timer",
      rawInput: { Seconds: 30 },
      part: { tool: "set_timer", toolType: "generic" },
    },
    {
      call: "a command before its command line",
      name: "run_command",
      title: "Run run_command",
      rawInput: {},
      part: { tool: "run_command", toolType: "generic" },
    },
  ])("shows $call of the kind execute as a tool row, never as an empty command", (entry) => {
    const transcript = createTranscript();
    transcript.addLiveUserMessage({ message: { text: "Work", displayParts: [] } });
    const events = transcript.applyUpdate(
      {
        sessionUpdate: "tool_call",
        toolCallId: "call-9",
        title: entry.title,
        name: entry.name,
        kind: "execute",
        status: "completed",
        rawInput: entry.rawInput,
      },
      "live",
    );

    const tool = events.flatMap((event) =>
      event.type === "assistant_part" && event.part.kind === "tool" ? [event.part] : [],
    );
    expect(tool.at(-1)).toMatchObject(entry.part);
  });

  test("streams text as deltas and confirms the final reply of a completed turn", () => {
    const transcript = createTranscript();
    transcript.addLiveUserMessage({ message: { text: "Hi", displayParts: [] } });
    const events = [
      ...transcript.applyUpdate(text("agent_message_chunk", "Hel"), "live"),
      ...transcript.applyUpdate(text("agent_message_chunk", "lo"), "live"),
      ...transcript.finishTurn("completed"),
    ];

    expect(events.map((event) => event.type)).toEqual([
      "assistant_delta",
      "assistant_delta",
      "assistant_part",
      "assistant_message",
    ]);
    expect(events.at(-1)).toMatchObject({ messageId: "session-1:t1:i1", message: "Hello" });
  });

  test("streams a goal reply without its marker and reports the complete goal", () => {
    const transcript = createTranscript();
    transcript.addLiveUserMessage({
      message: { text: "/goal Make the tests pass", displayParts: [] },
    });
    expect(transcript.goals.goal).toEqual({ objective: "Make the tests pass" });
    const events = [
      ...transcript.applyUpdate(text("agent_message_chunk", "All pass. <!-- GOAL_"), "live"),
      ...transcript.applyUpdate(text("agent_message_chunk", "COMPLETE -->"), "live"),
      ...transcript.finishTurn("completed"),
    ];

    // The stream never shows a part of the marker.
    const deltas = events.flatMap((event) =>
      event.type === "assistant_delta" ? [event.delta] : [],
    );
    expect(deltas.join("")).toBe("All pass. ");
    expect(events.at(-1)).toMatchObject({ type: "assistant_message", message: "All pass. " });
    expect(transcript.goals.goal).toEqual({ objective: "Make the tests pass", end: "met" });
  });

  test("rebuilds the goal from a replay, and the stop message removes a cancelled goal", () => {
    const replay = createTranscript();
    for (const update of [
      text("user_message_chunk", "/goal Ship it"),
      text("agent_message_chunk", "Working."),
      text("user_message_chunk", "Stop the current goal. I'll take it from here."),
      text("agent_message_chunk", "Stopped. <!-- GOAL_CANCELLED -->"),
      text("user_message_chunk", "/goal Ship it again"),
      text("agent_message_chunk", "Asked to stop. <!-- GOAL_CANCELLED -->"),
    ]) {
      replay.applyUpdate(update, "replay");
    }
    replay.finishReplay();

    // A cancel without the stop message of OpenDucktor ends the goal and keeps it to show.
    expect(replay.goals.goal).toEqual({ objective: "Ship it again", end: "cancelled" });
    expect(replay.history.map(({ text: body }) => body)).not.toContain(
      expect.stringContaining("GOAL_"),
    );
    expect(replay.goals.forgetEnded()).toBe(true);
    expect(replay.goals.goal).toBeNull();
  });

  test("shows a declined tool as cancelled, and an interrupted turn has no final reply", () => {
    const transcript = createTranscript();
    transcript.addLiveUserMessage({ message: { text: "Edit", displayParts: [] } });
    transcript.applyUpdate(
      {
        sessionUpdate: "tool_call",
        toolCallId: "edit-1",
        title: "Edit",
        kind: "edit",
        status: "pending",
      },
      "live",
    );
    const [declined] = transcript.markToolDeclined("edit-1");
    const finished = transcript.finishTurn("interrupted");

    expect(declined?.type === "assistant_part" ? declined.part : null).toMatchObject({
      status: "error",
      error: "The user or a policy declined this tool call.",
      toolType: "file_edit",
    });
    expect(finished.map((event) => event.type)).not.toContain("assistant_message");
  });

  test("gives a command its shell fields and output without the Antigravity header", () => {
    const transcript = createTranscript();
    const [event] = transcript.applyUpdate(
      {
        sessionUpdate: "tool_call",
        toolCallId: "run-1",
        title: "echo hi",
        name: "run_command",
        kind: "execute",
        status: "completed",
        rawInput: { CommandLine: "echo hi", WaitMsBeforeAsync: 5000, toolSummary: "Echo hi" },
        rawOutput: {
          output:
            "Created At: 2026-11-22T01:15:41+01:00\nCompleted At: 2026-11-22T01:15:41+01:00\nCommand exited with code 0.\n\nCommand output:\nhi\r\n",
          exit_code: 0,
        },
      },
      "live",
    );

    expect(event?.type === "assistant_part" ? event.part : null).toMatchObject({
      toolType: "bash",
      input: { command: "echo hi", description: "Echo hi", waitMsBeforeAsync: 5000 },
      output: "hi\n",
      metadata: { exit: 0 },
      status: "completed",
    });
  });

  test("gives a file write and a file edit their path and file diffs", () => {
    const transcript = createTranscript();
    const [write] = transcript.applyUpdate(
      {
        sessionUpdate: "tool_call",
        toolCallId: "write-1",
        title: "File notes.txt",
        name: "write_file",
        kind: "edit",
        status: "completed",
        content: [{ type: "diff", path: "/repo/notes.txt", newText: "x\n" }],
        rawInput: { Content: "x\n", Path: "/repo/notes.txt" },
      },
      "live",
    );
    const [edit] = transcript.applyUpdate(
      {
        sessionUpdate: "tool_call",
        toolCallId: "edit-1",
        title: "File notes.txt",
        name: "edit_file",
        kind: "edit",
        status: "completed",
        content: [{ type: "diff", path: "/repo/notes.txt", oldText: "x\n", newText: "y\n" }],
        rawInput: { Path: "/repo/notes.txt", Target: "x", Replacement: "y" },
      },
      "live",
    );

    // The rows show the shared tool names, and the details keep the native names.
    expect(write?.type === "assistant_part" ? write.part : null).toMatchObject({
      tool: "write_file",
      displayLabel: "write",
      toolType: "file_edit",
      input: { path: "/repo/notes.txt" },
      fileDiffs: [{ file: "/repo/notes.txt", type: "added", additions: 1, deletions: 0 }],
    });
    expect(edit?.type === "assistant_part" ? edit.part : null).toMatchObject({
      tool: "edit_file",
      displayLabel: "edit",
      fileDiffs: [{ file: "/repo/notes.txt", type: "modified", additions: 1, deletions: 1 }],
    });
    const editPart = edit?.type === "assistant_part" ? edit.part : null;
    expect(editPart?.kind === "tool" ? editPart.output : null).toBeUndefined();
  });

  test("names a managed tool of the session MCP server by its OpenDucktor tool name", () => {
    const transcript = createTranscript();
    const [event] = transcript.applyUpdate(
      {
        sessionUpdate: "tool_call",
        toolCallId: "mcp-2",
        title: "Run mcp_openducktor_session_c324d862_odt_read_task",
        name: "mcp_openducktor_session_c324d862_odt_read_task",
        kind: "other",
        status: "completed",
        rawInput: { taskId: "task-1", toolSummary: "Read task task-1" },
      },
      "live",
    );

    expect(event?.type === "assistant_part" ? event.part : null).toMatchObject({
      tool: "odt_read_task",
      toolType: "workflow",
      input: { taskId: "task-1" },
    });
    const part = event?.type === "assistant_part" ? event.part : null;
    expect(part?.kind === "tool" ? part.input : null).not.toHaveProperty("toolSummary");
  });

  test("drops a title that only names the tool", () => {
    const transcript = createTranscript();
    const [event] = transcript.applyUpdate(
      {
        sessionUpdate: "tool_call",
        toolCallId: "ask-1",
        title: "Run ask_question",
        name: "ask_question",
        kind: "other",
        status: "in_progress",
      },
      "live",
    );

    const part = event?.type === "assistant_part" ? event.part : null;
    expect(part?.kind === "tool" ? part.title : "missing").toBeUndefined();
  });

  test("keeps an unknown tool of the session MCP server a generic tool", () => {
    const transcript = createTranscript();
    const [event] = transcript.applyUpdate(
      {
        sessionUpdate: "tool_call",
        toolCallId: "mcp-3",
        title: "Run mcp_openducktor_session_odt_unknown",
        name: "mcp_openducktor_session_odt_unknown",
        kind: "other",
        status: "completed",
      },
      "live",
    );

    expect(event?.type === "assistant_part" ? event.part : null).toMatchObject({
      tool: "mcp_openducktor_session_odt_unknown",
      toolType: "generic",
    });
  });

  test("keeps a global server call that uses the managed server name a server tool", () => {
    const transcript = createTranscript();
    const [event] = transcript.applyUpdate(
      {
        sessionUpdate: "tool_call",
        toolCallId: "mcp-1",
        title: "odt_read_task",
        name: "call_mcp_tool",
        status: "completed",
        rawInput: {
          ServerName: "openducktor_session",
          ToolName: "odt_read_task",
          Arguments: { taskId: "task-1" },
        },
      },
      "live",
    );

    expect(event?.type === "assistant_part" ? event.part : null).toMatchObject({
      tool: "openducktor_session.odt_read_task",
      toolType: "generic",
      input: { taskId: "task-1" },
      status: "completed",
    });
  });

  test("gives the next admitted message the ID that it names in advance", () => {
    const transcript = createTranscript();
    const expected = transcript.nextUserMessageId();

    const { userMessage } = transcript.addLiveUserMessage({
      message: { text: "Hi", displayParts: [] },
    });

    expect(userMessage.messageId).toBe(expected);
    expect(userMessage.messageId).toBe("session-1:t1:user");
  });
});

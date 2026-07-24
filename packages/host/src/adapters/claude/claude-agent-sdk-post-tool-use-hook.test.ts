import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { createClaudePostToolUseHook } from "./claude-agent-sdk-post-tool-use-hook";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";

describe("createClaudePostToolUseHook", () => {
  test("records authoritative execution timing for ordinary tools", async () => {
    const session = createClaudeSession();
    const timedSession = session as typeof session & {
      toolEndedAtMsByCallId: Map<string, number>;
    };
    timedSession.toolEndedAtMsByCallId = new Map();
    const hook = createClaudePostToolUseHook({
      session: timedSession,
      now: () => "2026-06-25T20:00:01.000Z",
      emit: () => {},
    });

    await hook(
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        transcript_path: "/home/test/.claude/projects/repo/session-1.jsonl",
        cwd: "/repo",
        tool_name: "Read",
        tool_use_id: "tool-read-1",
        tool_input: { file_path: "/repo/README.md" },
        tool_response: { file: "/repo/README.md" },
        duration_ms: 250,
      },
      "tool-read-1",
      { signal: new AbortController().signal },
    );

    expect(session.toolStartedAtMsByCallId.get("tool-read-1")).toBe(
      Date.parse("2026-06-25T20:00:00.750Z"),
    );
    expect(timedSession.toolEndedAtMsByCallId.get("tool-read-1")).toBe(
      Date.parse("2026-06-25T20:00:01.000Z"),
    );
  });

  test("records authoritative execution timing for failed tools", async () => {
    const session = createClaudeSession();
    const timedSession = session as typeof session & {
      toolEndedAtMsByCallId: Map<string, number>;
    };
    timedSession.toolEndedAtMsByCallId = new Map();
    const hook = createClaudePostToolUseHook({
      session: timedSession,
      now: () => "2026-06-25T20:00:02.000Z",
      emit: () => {},
    });

    await hook(
      {
        hook_event_name: "PostToolUseFailure",
        session_id: "session-1",
        transcript_path: "/home/test/.claude/projects/repo/session-1.jsonl",
        cwd: "/repo",
        tool_name: "Bash",
        tool_use_id: "tool-bash-1",
        tool_input: { command: "false" },
        error: "Command failed",
        duration_ms: 400,
      },
      "tool-bash-1",
      { signal: new AbortController().signal },
    );

    expect(session.toolStartedAtMsByCallId.get("tool-bash-1")).toBe(
      Date.parse("2026-06-25T20:00:01.600Z"),
    );
    expect(timedSession.toolEndedAtMsByCallId.get("tool-bash-1")).toBe(
      Date.parse("2026-06-25T20:00:02.000Z"),
    );
  });

  test("projects structured file edit results without taking over session persistence", async () => {
    const events: AgentEvent[] = [];
    const session = createClaudeSession();
    session.toolMessageIdsByCallId.set("tool-edit-1", "assistant-1");
    session.toolStartedAtMsByCallId.set("tool-edit-1", Date.parse("2026-06-25T20:00:00.000Z"));
    const hook = createClaudePostToolUseHook({
      session,
      now: () => "2026-06-25T20:00:01.000Z",
      emit: (event) => events.push(event),
    });

    await hook(
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        transcript_path: "/home/test/.claude/projects/repo/session-1.jsonl",
        cwd: "/repo",
        tool_name: "Edit",
        tool_use_id: "tool-edit-1",
        tool_input: {
          file_path: "/repo/apps/api/src/lib/auth.ts",
          old_string: "google",
          new_string: "github",
        },
        tool_response: {
          filePath: "/repo/apps/api/src/lib/auth.ts",
          structuredPatch: [
            {
              oldStart: 50,
              oldLines: 1,
              newStart: 50,
              newLines: 1,
              lines: ["-    google", "+    github"],
            },
          ],
        },
      },
      "tool-edit-1",
      { signal: new AbortController().signal },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "assistant_part",
      externalSessionId: "session-1",
      part: {
        kind: "tool",
        messageId: "assistant-1",
        callId: "tool-edit-1",
        status: "completed",
        fileDiffs: [
          {
            file: "/repo/apps/api/src/lib/auth.ts",
            additions: 1,
            deletions: 1,
          },
        ],
      },
    });
  });

  test("projects created Write results as added file diffs", async () => {
    const events: AgentEvent[] = [];
    const session = createClaudeSession();
    session.toolMessageIdsByCallId.set("tool-write-1", "assistant-1");
    const hook = createClaudePostToolUseHook({
      session,
      now: () => "2026-06-25T20:00:01.000Z",
      emit: (event) => events.push(event),
    });

    await hook(
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        transcript_path: "/home/test/.claude/projects/repo/session-1.jsonl",
        cwd: "/repo",
        tool_name: "Write",
        tool_use_id: "tool-write-1",
        tool_input: {
          file_path: "src/new-file.ts",
          content: "export const value = 1;\n",
        },
        tool_response: {
          type: "create",
          filePath: "src/new-file.ts",
          content: "export const value = 1;\n",
          structuredPatch: [],
          originalFile: null,
          userModified: false,
        },
      },
      "tool-write-1",
      { signal: new AbortController().signal },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "assistant_part",
      externalSessionId: "session-1",
      part: {
        kind: "tool",
        messageId: "assistant-1",
        callId: "tool-write-1",
        status: "completed",
        fileDiffs: [
          {
            file: "src/new-file.ts",
            type: "added",
            additions: 1,
            deletions: 0,
            diff: expect.stringContaining("+export const value = 1;"),
          },
        ],
      },
    });
  });

  test("does not project subagent file edits into the parent transcript", async () => {
    const events: AgentEvent[] = [];
    const hook = createClaudePostToolUseHook({
      session: createClaudeSession(),
      now: () => "2026-06-25T20:00:01.000Z",
      emit: (event) => events.push(event),
    });

    await hook(
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        transcript_path: "/home/test/.claude/projects/repo/session-1.jsonl",
        cwd: "/repo",
        agent_id: "agent-1",
        tool_name: "Write",
        tool_use_id: "tool-write-1",
        tool_input: { file_path: "/repo/file.ts" },
        tool_response: { filePath: "/repo/file.ts", diff: "+content" },
      },
      "tool-write-1",
      { signal: new AbortController().signal },
    );

    expect(events).toEqual([]);
  });
});

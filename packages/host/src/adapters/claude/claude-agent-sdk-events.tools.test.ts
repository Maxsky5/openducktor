import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";

describe("handleClaudeSdkMessage tool events", () => {
  test("emits completed tool parts for Claude tool result user messages", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "mcp__openducktor__odt_set_plan",
              input: { taskId: "task-1" },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: [{ type: "text", text: "plan saved" }],
        },
        message: {
          role: "user",
          content: [],
        },
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { taskId: "task-1" },
          status: "running",
          startedAtMs: Date.parse("2026-06-25T20:00:00.000Z"),
          tool: "mcp__openducktor__odt_set_plan",
          toolType: "workflow",
        }),
      }),
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { taskId: "task-1" },
          messageId: "assistant-1",
          output: "plan saved",
          status: "completed",
          startedAtMs: Date.parse("2026-06-25T20:00:00.000Z"),
          endedAtMs: Date.parse("2026-06-25T20:00:01.000Z"),
          tool: "mcp__openducktor__odt_set_plan",
          toolType: "workflow",
        }),
      }),
    ]);
  });

  test("emits completed tool parts for Claude MCP tool result content blocks", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "mcp_tool_use",
              id: "tool-1",
              name: "mcp__openducktor__odt_read_task",
              input: { taskId: "task-1" },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-1",
        message: {
          role: "user",
          content: [
            {
              type: "mcp_tool_result",
              tool_use_id: "tool-1",
              content: [{ type: "text", text: "task loaded" }],
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    expect(events[1]).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { taskId: "task-1" },
          output: "task loaded",
          status: "completed",
          tool: "mcp__openducktor__odt_read_task",
          toolType: "workflow",
        }),
      }),
    );
  });

  test("does not invent generic tool rows for nameless orphan tool results", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "orphan-result-1",
        session_id: "session-1",
        parent_tool_use_id: "unknown-tool-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "unknown-tool-1",
          content: [{ type: "text", text: "unpaired output" }],
        },
        message: {
          role: "user",
          content: [],
        },
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([]);
  });

  test("emits errored tool parts for Claude tool result failures", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "exit 1" },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:02.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-1",
          is_error: true,
          content: [{ type: "text", text: "command failed" }],
        },
        message: {
          role: "user",
          content: [],
        },
      } as unknown as SDKMessage,
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          error: "command failed",
          input: { command: "exit 1" },
          messageId: "assistant-1",
          status: "error",
          startedAtMs: Date.parse("2026-06-25T20:00:00.000Z"),
          endedAtMs: Date.parse("2026-06-25T20:00:02.000Z"),
          tool: "Bash",
          toolType: "bash",
        }),
      }),
    );
  });

  test("maps Claude MCP tool-use blocks with input metadata", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "mcp_tool_use",
              id: "tool-1",
              name: "mcp__openducktor__odt_read_task",
              server_name: "openducktor",
              input: { taskId: "task-1" },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { taskId: "task-1" },
          metadata: {
            blockType: "mcp_tool_use",
            serverName: "openducktor",
          },
          status: "running",
          tool: "mcp__openducktor__odt_read_task",
          toolType: "workflow",
        }),
      }),
    ]);
  });

  test("matches SDK tool_use_id and tool_name fields across progress and results", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "server_tool_use",
              tool_use_id: "tool-1",
              tool_name: "Read",
              tool_input: { file_path: "apps/api/src/lib/auth.ts" },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:03.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "tool_progress",
        uuid: "progress-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        tool_use_id: "tool-1",
        tool_name: "Read",
        elapsed_time_seconds: 3,
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:04.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-1",
          tool_name: "Read",
          content: [{ type: "text", text: "file contents" }],
        },
        message: {
          role: "user",
          content: [],
        },
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { file_path: "apps/api/src/lib/auth.ts" },
          messageId: "assistant-1",
          status: "running",
          tool: "Read",
          toolType: "read",
        }),
      }),
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { file_path: "apps/api/src/lib/auth.ts" },
          messageId: "assistant-1",
          status: "running",
          tool: "Read",
          toolType: "read",
        }),
      }),
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { file_path: "apps/api/src/lib/auth.ts" },
          messageId: "assistant-1",
          output: "file contents",
          startedAtMs: Date.parse("2026-06-25T20:00:00.000Z"),
          endedAtMs: Date.parse("2026-06-25T20:00:04.000Z"),
          status: "completed",
          tool: "Read",
          toolType: "read",
        }),
      }),
    ]);
  });

  test("emits tool progress with runtime duration metadata", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.toolMessageIdsByCallId.set("tool-1", "assistant-1");
    session.toolInputsByCallId.set("tool-1", { command: "bun test" });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:10.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "tool_progress",
        uuid: "progress-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        tool_use_id: "tool-1",
        tool_name: "Bash",
        elapsed_time_seconds: 4.25,
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { command: "bun test" },
          messageId: "assistant-1",
          metadata: {
            elapsedTimeSeconds: 4.25,
            durationMs: 4250,
          },
          startedAtMs: Date.parse("2026-06-25T20:00:05.750Z"),
          status: "running",
          tool: "Bash",
        }),
      }),
    ]);
  });

  test("ignores forwarded tool progress before its subagent task is known", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:10.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "tool_progress",
        uuid: "progress-1",
        session_id: "session-1",
        parent_tool_use_id: "agent-tool-1",
        tool_use_id: "subagent-tool-1",
        tool_name: "Bash",
        elapsed_time_seconds: 4.25,
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([]);
  });
});

describe("handleClaudeSdkMessage denied tool events", () => {
  test("emits permission_denied events as errored tool parts with input and duration", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.toolInputsByCallId.set("tool-1", { command: "rm -rf dist" });
    session.toolStartedAtMsByCallId.set("tool-1", Date.parse("2026-06-25T20:00:00.000Z"));

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:03.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "system",
        subtype: "permission_denied",
        uuid: "permission-1",
        session_id: "session-1",
        tool_use_id: "tool-1",
        tool_name: "Bash",
        message: "Denied by policy",
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          error: "Denied by policy",
          input: { command: "rm -rf dist" },
          messageId: "permission-denied:tool-1",
          metadata: { source: "permission_denied" },
          preview: "rm -rf dist",
          status: "error",
          startedAtMs: Date.parse("2026-06-25T20:00:00.000Z"),
          endedAtMs: Date.parse("2026-06-25T20:00:03.000Z"),
          tool: "Bash",
          toolType: "bash",
        }),
      }),
    ]);
  });

  test("emits result permission denials as errored tool parts with denied input", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:03.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "result",
        subtype: "success",
        session_id: "session-1",
        duration_ms: 3000,
        duration_api_ms: 2000,
        is_error: false,
        num_turns: 1,
        permission_denials: [
          {
            tool_name: "Bash",
            tool_use_id: "tool-1",
            tool_input: { command: "touch /tmp/outside" },
          },
        ],
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          error: "Permission denied for Bash.",
          input: { command: "touch /tmp/outside" },
          messageId: "permission-denied:tool-1",
          metadata: { source: "result_permission_denial" },
          preview: "touch /tmp/outside",
          status: "error",
          endedAtMs: Date.parse("2026-06-25T20:00:03.000Z"),
          tool: "Bash",
          toolType: "bash",
        }),
      }),
    ]);
    expect(session.activity).toBe("running");
  });
});

describe("handleClaudeSdkMessage file edit tool events", () => {
  test("maps completed Claude Edit results to canonical file diffs", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-edit-1",
              name: "Edit",
              input: {
                file_path: "apps/api/src/lib/auth.ts",
                old_string: "providers: []",
                new_string: "providers: [facebook]",
              },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-edit-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-edit-1",
          content: [{ type: "text", text: "edited" }],
          gitDiff: {
            patch:
              "diff --git a/apps/api/src/lib/auth.ts b/apps/api/src/lib/auth.ts\n--- a/apps/api/src/lib/auth.ts\n+++ b/apps/api/src/lib/auth.ts\n@@ -1 +1 @@\n-providers: []\n+providers: [facebook]\n",
          },
        },
        message: {
          role: "user",
          content: [],
        },
      } as unknown as SDKMessage,
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-edit-1",
          status: "completed",
          tool: "Edit",
          toolType: "file_edit",
          fileDiffs: [
            expect.objectContaining({
              file: "apps/api/src/lib/auth.ts",
              additions: 1,
              deletions: 1,
              diff: expect.stringContaining("+providers: [facebook]"),
            }),
          ],
        }),
      }),
    );
  });

  test("maps completed Claude Edit structuredPatch results to canonical file diffs", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-edit-1",
              name: "Edit",
              input: {
                file_path: "apps/api/src/lib/auth.ts",
                old_string: "providers: []",
                new_string: "providers: [facebook]",
              },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-edit-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-edit-1",
          content: [{ type: "text", text: "edited" }],
          filePath: "apps/api/src/lib/auth.ts",
          oldString: "providers: []",
          newString: "providers: [facebook]",
          originalFile: "providers: []\n",
          structuredPatch: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ["-providers: []", "+providers: [facebook]"],
            },
          ],
          userModified: false,
          replaceAll: false,
        },
        message: {
          role: "user",
          content: [],
        },
      } as unknown as SDKMessage,
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-edit-1",
          status: "completed",
          tool: "Edit",
          toolType: "file_edit",
          fileDiffs: [
            expect.objectContaining({
              file: "apps/api/src/lib/auth.ts",
              additions: 1,
              deletions: 1,
              diff: expect.stringContaining("@@ -1,1 +1,1 @@"),
            }),
          ],
        }),
      }),
    );
  });

  test("does not synthesize live Claude Edit diffs from input-only tool results", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-edit-input",
              name: "Edit",
              input: {
                file_path: "apps/api/src/lib/auth.ts",
                old_string: "providers: []",
                new_string: "providers: [twitter]",
              },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-edit-input",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-edit-input",
          content: [{ type: "text", text: "edited" }],
        },
        message: {
          role: "user",
          content: [],
        },
      } as unknown as SDKMessage,
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-edit-input",
          status: "completed",
          tool: "Edit",
          toolType: "file_edit",
        }),
      }),
    );
    const event = events.at(-1);
    expect(event?.type === "assistant_part" && event.part.kind === "tool").toBe(true);
    if (event?.type === "assistant_part" && event.part.kind === "tool") {
      expect(event.part.fileDiffs).toBeUndefined();
    }
  });

  test("maps Claude Edit structured patches with absolute paths without double slash headers", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-edit-absolute-input",
              name: "Edit",
              input: {
                file_path: "/Users/maxsky5/projects/perso/fairnest-io69/apps/api/src/lib/auth.ts",
                old_string: "providers: []",
                new_string: "providers: [twitter]",
              },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-edit-absolute-input",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-edit-absolute-input",
          content: [{ type: "text", text: "edited" }],
          filePath: "/Users/maxsky5/projects/perso/fairnest-io69/apps/api/src/lib/auth.ts",
          structuredPatch: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ["-providers: []", "+providers: [twitter]"],
            },
          ],
        },
        message: {
          role: "user",
          content: [],
        },
      } as unknown as SDKMessage,
    });

    const event = events.at(-1);
    const fileDiff =
      event?.type === "assistant_part" && event.part.kind === "tool"
        ? event.part.fileDiffs?.[0]
        : undefined;
    expect(fileDiff).toMatchObject({
      file: "/Users/maxsky5/projects/perso/fairnest-io69/apps/api/src/lib/auth.ts",
      additions: 1,
      deletions: 1,
    });
    expect(fileDiff?.diff).toContain(
      "diff --git a/Users/maxsky5/projects/perso/fairnest-io69/apps/api/src/lib/auth.ts b/Users/maxsky5/projects/perso/fairnest-io69/apps/api/src/lib/auth.ts",
    );
    expect(fileDiff?.diff).not.toContain("a//Users");
  });

  test("does not synthesize live Claude MultiEdit diffs from input-only tool results", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-multiedit-input",
              name: "MultiEdit",
              input: {
                file_path: "apps/api/src/lib/auth.ts",
                edits: [
                  {
                    old_string: "google: {",
                    new_string: "twitter: {",
                  },
                  {
                    old_string: "AUTH_GOOGLE_ID",
                    new_string: "AUTH_TWITTER_ID",
                  },
                ],
              },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-multiedit-input",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-multiedit-input",
          content: [{ type: "text", text: "edited" }],
        },
        message: {
          role: "user",
          content: [],
        },
      } as unknown as SDKMessage,
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-multiedit-input",
          status: "completed",
          tool: "MultiEdit",
          toolType: "file_edit",
        }),
      }),
    );
    const event = events.at(-1);
    expect(event?.type === "assistant_part" && event.part.kind === "tool").toBe(true);
    if (event?.type === "assistant_part" && event.part.kind === "tool") {
      expect(event.part.fileDiffs).toBeUndefined();
    }
  });

  test("maps real Claude Edit top-level toolUseResult patches without dropping output", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-edit-real",
              name: "Edit",
              input: {
                file_path: "apps/api/src/lib/auth.ts",
                old_string: "providers: []",
                new_string: "providers: [facebook]",
              },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:02.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-edit-real",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-edit-real",
              content: "The file apps/api/src/lib/auth.ts has been updated successfully.",
            },
          ],
        },
        toolUseResult: {
          filePath: "apps/api/src/lib/auth.ts",
          oldString: "providers: []",
          newString: "providers: [facebook]",
          originalFile: "providers: []\n",
          structuredPatch: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ["-providers: []", "+providers: [facebook]"],
            },
          ],
          userModified: false,
          replaceAll: false,
        },
      } as unknown as SDKMessage,
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-edit-real",
          input: {
            file_path: "apps/api/src/lib/auth.ts",
            old_string: "providers: []",
            new_string: "providers: [facebook]",
          },
          output: "The file apps/api/src/lib/auth.ts has been updated successfully.",
          startedAtMs: Date.parse("2026-06-25T20:00:00.000Z"),
          endedAtMs: Date.parse("2026-06-25T20:00:02.000Z"),
          status: "completed",
          tool: "Edit",
          toolType: "file_edit",
          fileDiffs: [
            expect.objectContaining({
              file: "apps/api/src/lib/auth.ts",
              additions: 1,
              deletions: 1,
              diff: expect.stringContaining("+providers: [facebook]"),
            }),
          ],
        }),
      }),
    );
  });

  test("maps completed Claude Write structuredPatch results to canonical file diffs", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-write-1",
              name: "Write",
              input: {
                file_path: "README.md",
                content: "# Updated\n",
              },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-write-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-write-1",
          content: [{ type: "text", text: "written" }],
          structuredContent: {
            type: "update",
            filePath: "README.md",
            content: "# Updated\n",
            structuredPatch: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                lines: ["-# Old", "+# Updated"],
              },
            ],
            originalFile: "# Old\n",
          },
        },
        message: {
          role: "user",
          content: [],
        },
      } as unknown as SDKMessage,
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-write-1",
          status: "completed",
          tool: "Write",
          toolType: "file_edit",
          fileDiffs: [
            expect.objectContaining({
              file: "README.md",
              additions: 1,
              deletions: 1,
              diff: expect.stringContaining("+++ b/README.md"),
            }),
          ],
        }),
      }),
    );
  });

  test("maps real Claude Write top-level toolUseResult patches without dropping output", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-write-real",
              name: "Write",
              input: {
                file_path: "README.md",
                content: "# Updated\n",
              },
            },
          ],
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-write-real",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-write-real",
              content: "The file README.md has been updated successfully.",
            },
          ],
        },
        toolUseResult: {
          type: "update",
          filePath: "README.md",
          content: "# Updated\n",
          structuredPatch: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ["-# Old", "+# Updated"],
            },
          ],
          originalFile: "# Old\n",
          userModified: false,
        },
      } as unknown as SDKMessage,
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-write-real",
          input: {
            file_path: "README.md",
            content: "# Updated\n",
          },
          output: "The file README.md has been updated successfully.",
          status: "completed",
          tool: "Write",
          toolType: "file_edit",
          fileDiffs: [
            expect.objectContaining({
              file: "README.md",
              additions: 1,
              deletions: 1,
              diff: expect.stringContaining("+# Updated"),
            }),
          ],
        }),
      }),
    );
  });
});

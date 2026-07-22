import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

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
      message: claudeSdkMessageFixture({
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
      }),
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
      message: claudeSdkMessageFixture({
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
      }),
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
      message: claudeSdkMessageFixture({
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
      }),
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
      message: claudeSdkMessageFixture({
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
      }),
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
      message: claudeSdkMessageFixture({
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
      }),
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
      message: claudeSdkMessageFixture({
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
      }),
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
      message: claudeSdkMessageFixture({
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
      }),
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
      message: claudeSdkMessageFixture({
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
      }),
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
      message: claudeSdkMessageFixture({
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
      }),
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
      message: claudeSdkMessageFixture({
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
      }),
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

  test("maps real Claude Edit top-level tool_use_result patches without dropping output", () => {
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
      message: claudeSdkMessageFixture({
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
      }),
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
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: null,
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
        tool_use_result: {
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
      }),
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
      message: claudeSdkMessageFixture({
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
      }),
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
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        tool_use_result: {
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
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-write-1",
              content: "written",
            },
          ],
        },
      }),
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

  test("maps real Claude Write top-level tool_use_result patches without dropping output", () => {
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
      message: claudeSdkMessageFixture({
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
      }),
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
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: null,
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
        tool_use_result: {
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
      }),
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

  test("maps live Claude NotebookEdit results to canonical file diffs", () => {
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
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-notebook-1",
              name: "NotebookEdit",
              input: {
                notebook_path: "analysis.ipynb",
                cell_id: "cell-1",
                new_source: "print('new')",
              },
            },
          ],
        },
      }),
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
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-notebook-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-notebook-1",
          content: [{ type: "text", text: "Notebook cell updated" }],
          original_file: '{\n  "cells": [{"source": ["print(\'old\')"]}]\n}\n',
          updated_file: '{\n  "cells": [{"source": ["print(\'new\')"]}]\n}\n',
        },
        message: { role: "user", content: [] },
      }),
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-notebook-1",
          status: "completed",
          tool: "NotebookEdit",
          toolType: "file_edit",
          fileDiffs: [
            expect.objectContaining({
              file: "analysis.ipynb",
              additions: 1,
              deletions: 1,
              diff: expect.stringContaining("print('new')"),
            }),
          ],
        }),
      }),
    );
  });
});

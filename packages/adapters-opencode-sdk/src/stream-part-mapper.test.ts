import { describe, expect, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk/v2/client";
import { mapOpenCodeBackgroundTaskResultPart } from "./opencode-background-task-result";
import { mapPartToAgentStreamPart } from "./stream-part-mapper";

const createToolPart = ({
  id,
  status,
  input = {},
  output,
  error,
  title,
  metadata,
  time,
  tool = "todowrite",
}: {
  id: string;
  status?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: unknown;
  title?: unknown;
  metadata?: Record<string, unknown>;
  time?: { start?: number; end?: number };
  tool?: string;
}): Part => {
  const state: Record<string, unknown> = {
    input,
  };

  if (status !== undefined) {
    state.status = status;
  }
  if (output !== undefined) {
    state.output = output;
  }
  if (error !== undefined) {
    state.error = error;
  }
  if (title !== undefined) {
    state.title = title;
  }
  if (metadata !== undefined) {
    state.metadata = metadata;
  }
  if (time !== undefined) {
    state.time = time;
  }

  return {
    id,
    sessionID: "session-1",
    messageID: `assistant-${id}`,
    callID: `call-${id}`,
    type: "tool",
    tool,
    state,
  } as unknown as Part;
};

const createSyntheticTextPart = ({
  id,
  text,
  time,
}: {
  id: string;
  text: string;
  time?: { end?: number };
}): Part =>
  ({
    id,
    sessionID: "session-1",
    messageID: `user-${id}`,
    type: "text",
    synthetic: true,
    text,
    ...(time ? { time } : {}),
  }) as unknown as Part;

describe("stream-part-mapper", () => {
  test("uses normalized task strategies for subagent mapping", () => {
    for (const tool of ["task", "delegate", "functions.task", " Functions.Delegate "]) {
      const mapped = mapPartToAgentStreamPart(
        createToolPart({
          id: `tool-subagent-${tool}`,
          tool,
          status: "running",
          input: { agent: "build", prompt: "Inspect the adapter" },
        }),
      );

      expect(mapped?.kind, tool).toBe("subagent");
    }
  });

  test("maps raw subtask parts to canonical subagent parts", () => {
    const part = {
      id: "subtask-1",
      sessionID: "session-1",
      messageID: "assistant-subtask-1",
      type: "subtask",
      agent: "build",
      prompt: "Implement the plan",
      description: "Implement the plan",
      model: "gpt-5",
      command: "build",
    } as unknown as Part;

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toEqual({
      kind: "subagent",
      messageId: "assistant-subtask-1",
      partId: "subtask-1",
      correlationKey: "spawn:assistant-subtask-1:build:Implement the plan",
      status: "running",
      agent: "build",
      prompt: "Implement the plan",
      description: "Implement the plan",
      metadata: {
        model: "gpt-5",
        command: "build",
      },
    });
  });

  test("maps subagent tool families to canonical subagent parts", () => {
    const part = createToolPart({
      id: "tool-subagent-1",
      tool: "delegate",
      status: "completed",
      input: {
        agent: "planner",
        prompt: "Inspect the tests",
      },
      output: {
        result: "Done subtask",
        externalSessionId: "session-child-1",
      },
      metadata: {
        background: true,
        summary: [{ id: 1 }],
      },
      time: {
        start: 10,
        end: 40,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toEqual({
      kind: "subagent",
      messageId: "assistant-tool-subagent-1",
      partId: "tool-subagent-1",
      correlationKey: "spawn:assistant-tool-subagent-1:planner:Inspect the tests",
      status: "completed",
      agent: "planner",
      prompt: "Inspect the tests",
      description: "Done subtask",
      externalSessionId: "session-child-1",
      executionMode: "background",
      metadata: {
        background: true,
        summary: [{ id: 1 }],
      },
      startedAtMs: 10,
      endedAtMs: 40,
    });
  });

  test("keeps completed OpenCode background task results running while the child session is active", () => {
    const part = createToolPart({
      id: "tool-background-task-running-1",
      tool: "task",
      status: "completed",
      input: {
        subagent_type: "build",
        prompt: "Inspect the repo",
        description: "Inspect the race",
      },
      output: [
        '<task id="session-child-background-1" state="running">',
        "<summary>Background task started</summary>",
        "<task_result>",
        "The task is running in the background.",
        "</task_result>",
        "</task>",
      ].join("\n"),
      metadata: {
        background: true,
        sessionId: "session-child-background-1",
        jobId: "session-child-background-1",
      },
      time: {
        start: 10,
        end: 40,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "subagent",
      messageId: "assistant-tool-background-task-running-1",
      partId: "tool-background-task-running-1",
      status: "running",
      agent: "build",
      prompt: "Inspect the repo",
      description: "Inspect the race",
      externalSessionId: "session-child-background-1",
      executionMode: "background",
      metadata: {
        background: true,
        sessionId: "session-child-background-1",
        jobId: "session-child-background-1",
      },
      startedAtMs: 10,
    });
    expect(mapped).not.toEqual(expect.objectContaining({ endedAtMs: expect.any(Number) }));
  });

  test("preserves structured background task failures as terminal errors", () => {
    const part = createToolPart({
      id: "tool-background-task-error-1",
      tool: "task",
      status: "completed",
      input: {
        subagent_type: "build",
        prompt: "Inspect the repo",
      },
      output: {
        content: [{ type: "text", text: "Task failed" }],
        isError: true,
      },
      metadata: {
        background: true,
        sessionId: "session-child-background-error-1",
      },
      time: {
        start: 10,
        end: 40,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "subagent",
      status: "error",
      error: "Task failed",
      externalSessionId: "session-child-background-error-1",
      executionMode: "background",
      endedAtMs: 40,
    });
  });

  test("preserves cancelled background task tool results as terminal", () => {
    const part = createToolPart({
      id: "tool-background-task-cancelled-1",
      tool: "task",
      status: "cancelled",
      input: {
        subagent_type: "build",
        prompt: "Inspect the repo",
      },
      output: [
        '<task id="session-child-background-cancelled-1" state="running">',
        "<summary>Background task started</summary>",
        "<task_result>",
        "The task is running in the background.",
        "</task_result>",
        "</task>",
      ].join("\n"),
      metadata: {
        background: true,
        sessionId: "session-child-background-cancelled-1",
      },
      time: {
        start: 10,
        end: 40,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "subagent",
      status: "cancelled",
      externalSessionId: "session-child-background-cancelled-1",
      executionMode: "background",
      endedAtMs: 40,
    });
  });

  test("maps synthetic completed background task text without truncating raw result lines", () => {
    const part = createSyntheticTextPart({
      id: "text-background-completed-1",
      text: [
        '<task id="session-child-completed-1" state="completed">',
        "<task_result>",
        "rendered raw line:",
        "</task_result>",
        "actual final output",
        "</task_result>",
        "</task>",
      ].join("\n"),
      time: {
        end: Date.parse("2026-02-22T12:00:45.000Z"),
      },
    });

    const mapped = mapOpenCodeBackgroundTaskResultPart(part, {
      correlationKey: "part:assistant-background:subtask-a",
      timestamp: "2026-02-22T12:00:40.000Z",
    });

    expect(mapped).toMatchObject({
      kind: "subagent",
      partId: "text-background-completed-1",
      correlationKey: "part:assistant-background:subtask-a",
      status: "completed",
      description: "rendered raw line:\n</task_result>\nactual final output",
      externalSessionId: "session-child-completed-1",
      executionMode: "background",
      endedAtMs: Date.parse("2026-02-22T12:00:45.000Z"),
    });
  });

  test("maps synthetic errored background task text with inline summary", () => {
    const part = createSyntheticTextPart({
      id: "text-background-error-1",
      text: [
        '<task id="session-child-error-1" state="error">',
        "<summary>Background task failed: Run tests</summary>",
        "<task_error>",
        "Tests failed.",
        "</task_error>",
        "</task>",
      ].join("\n"),
    });

    const mapped = mapOpenCodeBackgroundTaskResultPart(part, {
      correlationKey: "part:assistant-background:subtask-a",
      timestamp: "2026-02-22T12:00:45.000Z",
    });

    expect(mapped).toMatchObject({
      kind: "subagent",
      partId: "text-background-error-1",
      correlationKey: "part:assistant-background:subtask-a",
      status: "error",
      description: "Background task failed: Run tests",
      error: "Tests failed.",
      externalSessionId: "session-child-error-1",
      executionMode: "background",
      endedAtMs: Date.parse("2026-02-22T12:00:45.000Z"),
    });
  });

  test("ignores malformed synthetic background task text", () => {
    const part = createSyntheticTextPart({
      id: "text-background-malformed-1",
      text: [
        '<task id="session-child-malformed-1" state="completed">',
        "<task_result>",
        "missing close task tag",
        "</task_result>",
      ].join("\n"),
    });

    expect(mapOpenCodeBackgroundTaskResultPart(part)).toBeNull();
  });

  test("does not map the unsupported subtask tool alias to a subagent part", () => {
    const part = createToolPart({
      id: "tool-subtask-1",
      tool: "subtask",
      status: "running",
      input: {
        subagent_type: "explorer",
        prompt: "Read a file",
        description: "Read a file",
      },
      time: {
        start: 10,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "tool",
      messageId: "assistant-tool-subtask-1",
      partId: "tool-subtask-1",
      tool: "subtask",
      status: "running",
      input: {
        subagent_type: "explorer",
        prompt: "Read a file",
        description: "Read a file",
      },
    });
  });

  test("maps edit tool filediff metadata to canonical file changes", () => {
    const part = createToolPart({
      id: "tool-edit-1",
      tool: "edit",
      status: "completed",
      input: { filePath: "/repo/src/main.ts" },
      output: "Edited src/main.ts",
      metadata: {
        filediff: {
          file: "/repo/src/main.ts",
          patch: "@@ -1 +1 @@\n-old\n+new",
          additions: 1,
          deletions: 1,
        },
      },
      time: { start: 10, end: 20 },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "tool",
      tool: "edit",
      toolType: "file_edit",
      output: "Edited src/main.ts",
      fileDiffs: [
        {
          file: "/repo/src/main.ts",
          type: "modified",
          additions: 1,
          deletions: 1,
          diff: "--- a/repo/src/main.ts\n+++ b/repo/src/main.ts\n@@ -1 +1 @@\n-old\n+new\n",
        },
      ],
    });
  });

  test("keeps modified full-file tool metadata path-only instead of rendering file contents", () => {
    const part = createToolPart({
      id: "tool-edit-full-file-1",
      tool: "edit",
      status: "completed",
      input: { filePath: "/repo/src/main.ts" },
      output: "Edited src/main.ts",
      metadata: {
        filediff: {
          file: "/repo/src/main.ts",
          patch: "import { render } from '@testing-library/react';\nfunction AuthConsumer() {}\n",
          additions: 2,
          deletions: 0,
        },
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "tool",
      tool: "edit",
      toolType: "file_edit",
      fileDiffs: [
        {
          file: "/repo/src/main.ts",
          type: "modified",
          additions: 2,
          deletions: 0,
          diff: "",
        },
      ],
    });
  });

  test("maps edit-created files to added canonical file changes", () => {
    const part = createToolPart({
      id: "tool-edit-created-1",
      tool: "edit",
      status: "completed",
      input: { filePath: "/repo/src/new.ts", oldString: "", newString: "created\n" },
      output: "Edit applied successfully.",
      metadata: {
        filediff: {
          file: "/repo/src/new.ts",
          patch: "--- /repo/src/new.ts\n+++ /repo/src/new.ts\n@@ -0,0 +1 @@\n+created",
          additions: 1,
          deletions: 0,
        },
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "tool",
      tool: "edit",
      toolType: "file_edit",
      fileDiffs: [
        {
          file: "/repo/src/new.ts",
          type: "added",
          additions: 1,
          deletions: 0,
          diff: "--- /repo/src/new.ts\n+++ /repo/src/new.ts\n@@ -0,0 +1 @@\n+created\n",
        },
      ],
    });
  });

  test("maps write tool diff metadata to canonical file diffs", () => {
    const part = createToolPart({
      id: "tool-write-1",
      tool: "write",
      status: "completed",
      input: {
        filePath: "/repo/src/main.ts",
        content: "new\n",
      },
      output: "Wrote file successfully.",
      metadata: {
        filepath: "/repo/src/main.ts",
        diff: "--- /repo/src/main.ts\n+++ /repo/src/main.ts\n@@ -1 +1 @@\n-old\n+new",
        exists: true,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "tool",
      tool: "write",
      toolType: "file_edit",
      fileDiffs: [
        {
          file: "/repo/src/main.ts",
          type: "modified",
          additions: 1,
          deletions: 1,
          diff: "--- /repo/src/main.ts\n+++ /repo/src/main.ts\n@@ -1 +1 @@\n-old\n+new\n",
        },
      ],
    });
  });

  test("maps existing-file write tool content to canonical file content when no diff exists", () => {
    const part = createToolPart({
      id: "tool-write-content-1",
      tool: "write",
      status: "completed",
      input: {
        filePath: "/repo/src/main.ts",
        content: "export const value = 1;\n",
      },
      output: "Wrote file successfully.",
      metadata: {
        filepath: "/repo/src/main.ts",
        exists: true,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "tool",
      tool: "write",
      toolType: "file_edit",
      fileContent: [
        {
          file: "/repo/src/main.ts",
          type: "modified",
          content: "export const value = 1;\n",
        },
      ],
    });
    expect(mapped).not.toEqual(expect.objectContaining({ fileDiffs: expect.any(Array) }));
  });

  test("renders completed new-file write tool input as an added-file diff", () => {
    const part = createToolPart({
      id: "tool-write-new-file-1",
      tool: "write",
      status: "completed",
      input: {
        filePath: "/repo/apps/web/src/contexts/__tests__/AuthContext.test.tsx",
        content: "import { render } from '@testing-library/react';\nfunction AuthConsumer() {}\n",
      },
      output: "Wrote file successfully.",
      metadata: {
        filepath: "/repo/apps/web/src/contexts/__tests__/AuthContext.test.tsx",
        exists: false,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "tool",
      tool: "write",
      toolType: "file_edit",
      fileDiffs: [
        {
          file: "/repo/apps/web/src/contexts/__tests__/AuthContext.test.tsx",
          type: "added",
          additions: 2,
          deletions: 0,
          diff: "--- /dev/null\n+++ b/repo/apps/web/src/contexts/__tests__/AuthContext.test.tsx\n@@ -0,0 +1,2 @@\n+import { render } from '@testing-library/react';\n+function AuthConsumer() {}\n",
        },
      ],
    });
  });

  test("maps apply_patch files metadata to canonical file changes", () => {
    const part = createToolPart({
      id: "tool-patch-1",
      tool: "apply_patch",
      status: "completed",
      input: { patch: "*** Begin Patch\n*** Add File: src/new.ts\n+created\n*** End Patch" },
      output: "Patch applied",
      metadata: {
        files: [
          {
            filePath: "/repo/src/new.ts",
            relativePath: "src/new.ts",
            type: "add",
            patch: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1 @@\n+created",
            additions: 1,
            deletions: 0,
          },
        ],
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "tool",
      tool: "apply_patch",
      toolType: "file_edit",
      output: "Patch applied",
      fileDiffs: [
        {
          file: "src/new.ts",
          type: "added",
          additions: 1,
          deletions: 0,
          diff: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1 @@\n+created\n",
        },
      ],
    });
  });

  test("maps apply_patch move metadata to the target path", () => {
    const part = createToolPart({
      id: "tool-patch-move-1",
      tool: "apply_patch",
      status: "completed",
      input: {
        patch:
          "*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n-old\n+new\n*** End Patch",
      },
      output: "Patch applied",
      metadata: {
        files: [
          {
            filePath: "/repo/src/old.ts",
            relativePath: "src/new.ts",
            type: "move",
            patch: "--- /repo/src/old.ts\n+++ /repo/src/old.ts\n@@\n-old\n+new",
            additions: 1,
            deletions: 1,
            movePath: "/repo/src/new.ts",
          },
        ],
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "tool",
      tool: "apply_patch",
      toolType: "file_edit",
      fileDiffs: [
        {
          file: "src/new.ts",
          type: "modified",
          additions: 1,
          deletions: 1,
          diff: "--- /repo/src/old.ts\n+++ /repo/src/old.ts\n@@\n-old\n+new\n",
        },
      ],
    });
  });

  test("preserves cancelled subagent tool statuses", () => {
    const part = createToolPart({
      id: "tool-subagent-cancelled-1",
      tool: "delegate",
      status: "cancelled",
      input: {
        agent: "planner",
        prompt: "Inspect the tests",
      },
      output: {
        result: "Cancelled by user",
        externalSessionId: "session-child-cancelled-1",
      },
      time: {
        start: 10,
        end: 25,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toEqual({
      kind: "subagent",
      messageId: "assistant-tool-subagent-cancelled-1",
      partId: "tool-subagent-cancelled-1",
      correlationKey: "spawn:assistant-tool-subagent-cancelled-1:planner:Inspect the tests",
      status: "cancelled",
      agent: "planner",
      prompt: "Inspect the tests",
      description: "Cancelled by user",
      externalSessionId: "session-child-cancelled-1",
      startedAtMs: 10,
      endedAtMs: 25,
    });
  });

  test("preserves structured subagent tool failures as error status", () => {
    const part = createToolPart({
      id: "tool-subagent-error-1",
      tool: "delegate",
      status: "completed",
      input: {
        agent: "planner",
        prompt: "Inspect the tests",
      },
      output: {
        content: [{ type: "text", text: "Task failed" }],
        isError: true,
      },
      metadata: {
        externalSessionId: "session-child-error-1",
      },
      time: {
        start: 10,
        end: 25,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toEqual({
      kind: "subagent",
      messageId: "assistant-tool-subagent-error-1",
      partId: "tool-subagent-error-1",
      correlationKey: "spawn:assistant-tool-subagent-error-1:planner:Inspect the tests",
      status: "error",
      agent: "planner",
      prompt: "Inspect the tests",
      description: "Inspect the tests",
      error: "Task failed",
      externalSessionId: "session-child-error-1",
      metadata: {
        externalSessionId: "session-child-error-1",
      },
      startedAtMs: 10,
      endedAtMs: 25,
    });
  });

  test("preserves direct runtime subagent tool errors", () => {
    const part = createToolPart({
      id: "tool-subagent-direct-error-1",
      tool: "task",
      status: "failed",
      input: {
        subagent_type: "explorer",
        prompt: "Read the file at ~/maxsky5.omp.json",
        description: "Read the file at ~/maxsky5.omp.json",
      },
      error: "Timed out after 5m while waiting for permission.",
      metadata: {
        externalSessionId: "session-child-timeout-1",
      },
      time: {
        start: 10,
        end: 300_010,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toEqual({
      kind: "subagent",
      messageId: "assistant-tool-subagent-direct-error-1",
      partId: "tool-subagent-direct-error-1",
      correlationKey:
        "spawn:assistant-tool-subagent-direct-error-1:explorer:Read the file at ~/maxsky5.omp.json",
      status: "error",
      agent: "explorer",
      prompt: "Read the file at ~/maxsky5.omp.json",
      description: "Read the file at ~/maxsky5.omp.json",
      error: "Timed out after 5m while waiting for permission.",
      externalSessionId: "session-child-timeout-1",
      metadata: {
        externalSessionId: "session-child-timeout-1",
      },
      startedAtMs: 10,
      endedAtMs: 300_010,
    });
  });

  test("maps completed subagent tool parts with direct runtime errors as error status", () => {
    const part = createToolPart({
      id: "tool-subagent-completed-direct-error-1",
      tool: "task",
      status: "completed",
      input: {
        subagent_type: "explorer",
        prompt: "Read omp.json file",
      },
      error: "Timed out after 5m while waiting for permission.",
      time: {
        start: 10,
        end: 300_010,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toMatchObject({
      kind: "subagent",
      status: "error",
      error: "Timed out after 5m while waiting for permission.",
    });
  });

  test("maps task tool parts with metadata session ids to canonical subagent parts", () => {
    const part = createToolPart({
      id: "tool-task-1",
      tool: "task",
      status: "running",
      input: {
        subagent_type: "build",
        prompt: "Inspect the repo",
        description: "Starting subagent",
      },
      metadata: {
        externalSessionId: "session-child-task-1",
      },
      time: {
        start: 25,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toEqual({
      kind: "subagent",
      messageId: "assistant-tool-task-1",
      partId: "tool-task-1",
      correlationKey: "spawn:assistant-tool-task-1:build:Inspect the repo",
      status: "running",
      agent: "build",
      prompt: "Inspect the repo",
      description: "Starting subagent",
      externalSessionId: "session-child-task-1",
      metadata: {
        externalSessionId: "session-child-task-1",
      },
      startedAtMs: 25,
    });
  });

  test("keeps the same correlation key when tool completion changes the description", () => {
    const spawnPart = {
      id: "subtask-identity-1",
      sessionID: "session-1",
      messageID: "assistant-identity-1",
      type: "subtask",
      agent: "build",
      prompt: "Inspect the repo",
      description: "Starting work",
    } as unknown as Part;

    const completionPart = {
      id: "tool-identity-1",
      sessionID: "session-1",
      messageID: "assistant-identity-1",
      callID: "call-identity-1",
      type: "tool",
      tool: "delegate",
      state: {
        status: "completed",
        input: {
          agent: "build",
          prompt: "Inspect the repo",
        },
        output: {
          result: "Finished work",
          externalSessionId: "session-child-identity-1",
        },
      },
    } as unknown as Part;

    const spawned = mapPartToAgentStreamPart(spawnPart);
    const completed = mapPartToAgentStreamPart(completionPart);

    if (spawned?.kind !== "subagent") {
      throw new Error("Expected spawned subagent part");
    }
    if (completed?.kind !== "subagent") {
      throw new Error("Expected completed subagent part");
    }

    expect(spawned.correlationKey).toBe("spawn:assistant-identity-1:build:Inspect the repo");
    expect(completed.correlationKey).toBe("spawn:assistant-identity-1:build:Inspect the repo");
    expect(completed.description).toBe("Finished work");
    expect(completed.externalSessionId).toBe("session-child-identity-1");
  });

  test("derives preview hints for current tool families", () => {
    const cases = [
      {
        label: "shell",
        part: createToolPart({
          id: "preview-shell",
          tool: "bash",
          status: "running",
          input: { command: "bun run test --filter @openducktor/frontend" },
          title: "Run desktop tests",
        }),
        expectedPreview: "bun run test --filter @openducktor/frontend",
      },
      {
        label: "skill",
        part: createToolPart({
          id: "preview-skill",
          tool: "skill",
          status: "completed",
          input: { name: "clean-ddd-hexagonal" },
          output: "loaded skill output",
        }),
        expectedPreview: "clean-ddd-hexagonal",
      },
      {
        label: "odt read task",
        part: createToolPart({
          id: "preview-odt-read",
          tool: "odt_read_task",
          status: "completed",
          input: { taskId: "task-77" },
          output: {
            task: {
              id: "task-77",
              title: "Improve chat tool previews",
            },
          },
        }),
        expectedPreview: "task-77",
      },
      {
        label: "question",
        part: createToolPart({
          id: "preview-question",
          tool: "question",
          status: "completed",
          input: {
            questions: [{ question: "Which runtime should we use?" }],
          },
        }),
        expectedPreview: "Which runtime should we use?",
      },
      {
        label: "web",
        part: createToolPart({
          id: "preview-web",
          tool: "webfetch",
          status: "completed",
          input: { url: "https://example.com/docs" },
        }),
        expectedPreview: "https://example.com/docs",
      },
      {
        label: "context7",
        part: createToolPart({
          id: "preview-context7",
          tool: "context7_query-docs",
          status: "completed",
          input: {
            libraryId: "/vercel/next.js",
            query: "app router metadata examples",
          },
        }),
        expectedPreview: "app router metadata examples",
      },
    ] as const;

    for (const testCase of cases) {
      const mapped = mapPartToAgentStreamPart(testCase.part);
      expect(mapped).toBeTruthy();
      if (mapped?.kind !== "tool") {
        throw new Error(`Expected mapped tool part for ${testCase.label}.`);
      }
      expect(mapped.preview).toBe(testCase.expectedPreview);
    }
  });

  test("maps completed MCP tool output with isError as tool error part and omits title", () => {
    const part = createToolPart({
      id: "tool-1",
      tool: "openducktor_odt_set_spec",
      status: "completed",
      input: { taskId: "task-1" },
      output: {
        content: [{ type: "text", text: "Task not found" }],
        isError: true,
      },
      metadata: {
        scope: "mcp",
      },
      title: "Spec write",
      time: {
        start: 100,
        end: 130,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-1",
      partId: "tool-1",
      callId: "call-tool-1",
      tool: "openducktor_odt_set_spec",
      toolType: "workflow",
      status: "error",
      input: { taskId: "task-1" },
      preview: "task-1",
      error: "Task not found",
      metadata: {
        scope: "mcp",
      },
      startedAtMs: 100,
      endedAtMs: 130,
    });
  });

  test("maps completed tool metadata structured error as tool error part", () => {
    const part = createToolPart({
      id: "tool-1b",
      tool: "openducktor_odt_set_spec",
      status: "completed",
      input: { taskId: "task-1" },
      output: "completed",
      metadata: {
        structuredContent: {
          ok: false,
          error: {
            code: "ODT_TOOL_EXECUTION_ERROR",
            message:
              "set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: closed)",
          },
        },
      },
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-1b",
      partId: "tool-1b",
      callId: "call-tool-1b",
      tool: "openducktor_odt_set_spec",
      toolType: "workflow",
      status: "error",
      input: { taskId: "task-1" },
      preview: "task-1",
      error:
        "set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: closed)",
      metadata: {
        structuredContent: {
          ok: false,
          error: {
            code: "ODT_TOOL_EXECUTION_ERROR",
            message:
              "set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: closed)",
          },
        },
      },
    });
  });

  test("maps completed tool output containing flattened structured error JSON as tool error part", () => {
    const part = createToolPart({
      id: "tool-1c",
      tool: "openducktor_odt_set_plan",
      status: "completed",
      input: { taskId: "task-7" },
      output: JSON.stringify(
        {
          ok: false,
          error: {
            code: "ODT_TOOL_EXECUTION_ERROR",
            message: "Only epics can receive subtask proposals during planning.",
          },
        },
        null,
        2,
      ),
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-1c",
      partId: "tool-1c",
      callId: "call-tool-1c",
      tool: "openducktor_odt_set_plan",
      toolType: "workflow",
      status: "error",
      input: { taskId: "task-7" },
      preview: "task-7",
      error: "Only epics can receive subtask proposals during planning.",
    });
  });

  test("maps completed ODT MCP protocol validation text as tool error part", () => {
    const protocolError =
      'MCP error -32602: Input validation error: Invalid arguments for tool odt_set_pull_request: [{"path":["workspaceId"],"message":"Invalid input: expected never, received string"}]';
    const part = createToolPart({
      id: "tool-1d",
      tool: "odt_set_pull_request",
      status: "completed",
      input: { taskId: "task-7", workspaceId: "repo", providerId: "github", number: 42 },
      output: protocolError,
      metadata: { source: "mcp" },
      time: { start: 500, end: 700 },
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-1d",
      partId: "tool-1d",
      callId: "call-tool-1d",
      tool: "odt_set_pull_request",
      toolType: "workflow",
      status: "error",
      input: { taskId: "task-7", workspaceId: "repo", providerId: "github", number: 42 },
      preview: "task-7 · github · #42",
      error: protocolError,
      metadata: { source: "mcp" },
      startedAtMs: 500,
      endedAtMs: 700,
    });
  });

  test("maps MCP content text structured errors without structuredContent", () => {
    const part = createToolPart({
      id: "tool-1e",
      tool: "odt_set_spec",
      status: "completed",
      input: { taskId: "task-8" },
      output: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: {
                code: "ODT_TOOL_EXECUTION_ERROR",
                message: "Cannot write spec from current state.",
              },
            }),
          },
        ],
      },
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-1e",
      partId: "tool-1e",
      callId: "call-tool-1e",
      tool: "odt_set_spec",
      toolType: "workflow",
      status: "error",
      input: { taskId: "task-8" },
      preview: "task-8",
      error: "Cannot write spec from current state.",
    });
  });

  test("maps stringified MCP content text structured errors", () => {
    const part = createToolPart({
      id: "tool-1e-string",
      tool: "odt_set_spec",
      status: "completed",
      input: { taskId: "task-8" },
      output: JSON.stringify({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: {
                code: "ODT_TOOL_EXECUTION_ERROR",
                message: "Cannot write spec from serialized MCP content.",
              },
            }),
          },
        ],
      }),
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-1e-string",
      partId: "tool-1e-string",
      callId: "call-tool-1e-string",
      tool: "odt_set_spec",
      toolType: "workflow",
      status: "error",
      input: { taskId: "task-8" },
      preview: "task-8",
      error: "Cannot write spec from serialized MCP content.",
    });
  });

  test("keeps successful output containing the word error as completed", () => {
    const part = createToolPart({
      id: "tool-1f",
      tool: "odt_read_task",
      status: "completed",
      input: { taskId: "task-9" },
      output: "The task title mentions error handling but the call succeeded.",
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-1f",
      partId: "tool-1f",
      callId: "call-tool-1f",
      tool: "odt_read_task",
      toolType: "workflow",
      status: "completed",
      input: { taskId: "task-9" },
      preview: "task-9",
      output: "The task title mentions error handling but the call succeeded.",
    });
  });

  test("keeps successful structured output with a top-level error field as completed", () => {
    const output = {
      ok: true,
      error: {
        message: "non-fatal validation notes are present",
      },
      data: {
        taskId: "task-10",
      },
    };
    const part = createToolPart({
      id: "tool-1g",
      tool: "custom_mcp_tool",
      status: "completed",
      input: { taskId: "task-10" },
      output,
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-1g",
      partId: "tool-1g",
      callId: "call-tool-1g",
      tool: "custom_mcp_tool",
      toolType: "generic",
      status: "completed",
      input: { taskId: "task-10" },
      output: JSON.stringify(output, null, 2),
    });
  });

  test("maps pending tool with end timing as completed", () => {
    const part = createToolPart({
      id: "tool-2",
      status: "pending",
      input: {
        todos: [{ id: "todo-1", content: "A" }],
      },
      time: {
        start: 1,
        end: 2,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-2",
      partId: "tool-2",
      callId: "call-tool-2",
      tool: "todowrite",
      toolType: "todo",
      status: "completed",
      input: {
        todos: [{ id: "todo-1", content: "A" }],
      },
      preview: "1 todo",
      startedAtMs: 1,
      endedAtMs: 2,
    });
  });

  test("falls back to state timing when direct timing fields are non-numeric", () => {
    const part = {
      ...createToolPart({
        id: "tool-2b",
        status: "completed",
        input: {},
        time: {
          start: 111,
          end: 222,
        },
      }),
      time: {
        start: "invalid",
        end: "invalid",
      },
    } as unknown as Part;

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-2b",
      partId: "tool-2b",
      callId: "call-tool-2b",
      tool: "todowrite",
      toolType: "todo",
      status: "completed",
      input: {},
      startedAtMs: 111,
      endedAtMs: 222,
    });
  });

  test("maps started tool without end timing as running and keeps title", () => {
    const part = createToolPart({
      id: "tool-3",
      status: "started",
      input: {},
      title: "Working",
      time: {
        start: 25,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-3",
      partId: "tool-3",
      callId: "call-tool-3",
      tool: "todowrite",
      toolType: "todo",
      status: "running",
      input: {},
      title: "Working",
      startedAtMs: 25,
    });
  });

  test("maps failed tool status as error without title field", () => {
    const part = createToolPart({
      id: "tool-4",
      status: "failed",
      input: {},
      title: "Failure title",
      error: "Execution failed",
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-4",
      partId: "tool-4",
      callId: "call-tool-4",
      tool: "todowrite",
      toolType: "todo",
      status: "error",
      input: {},
      error: "Execution failed",
    });
  });

  test("prefers structured error message for tool parts already marked as error", () => {
    const part = createToolPart({
      id: "tool-4b",
      status: "error",
      input: {},
      error: "Generic failure",
      metadata: {
        structuredContent: {
          ok: false,
          error: {
            code: "ODT_TOOL_EXECUTION_ERROR",
            message: "Specific structured failure",
          },
        },
      },
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-4b",
      partId: "tool-4b",
      callId: "call-tool-4b",
      tool: "todowrite",
      toolType: "todo",
      status: "error",
      input: {},
      error: "Specific structured failure",
      metadata: {
        structuredContent: {
          ok: false,
          error: {
            code: "ODT_TOOL_EXECUTION_ERROR",
            message: "Specific structured failure",
          },
        },
      },
    });
  });

  test("normalizes tool statuses across known and fallback values", () => {
    const cases = [
      { rawStatus: "completed", hasEndedTiming: false, expectedStatus: "completed" },
      { rawStatus: "completed", hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: "error", hasEndedTiming: false, expectedStatus: "error" },
      { rawStatus: "failed", hasEndedTiming: false, expectedStatus: "error" },
      { rawStatus: "pending", hasEndedTiming: false, expectedStatus: "pending" },
      { rawStatus: "pending", hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: "running", hasEndedTiming: false, expectedStatus: "running" },
      { rawStatus: "running", hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: "started", hasEndedTiming: false, expectedStatus: "running" },
      { rawStatus: "started", hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: "unknown", hasEndedTiming: false, expectedStatus: "running" },
      { rawStatus: "unknown", hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: "", hasEndedTiming: false, expectedStatus: "running" },
      { rawStatus: "", hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: undefined, hasEndedTiming: false, expectedStatus: "running" },
      { rawStatus: undefined, hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: "   ", hasEndedTiming: false, expectedStatus: "running" },
      { rawStatus: "   ", hasEndedTiming: true, expectedStatus: "completed" },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const part = createToolPart({
        id: `status-${index}`,
        status: testCase.rawStatus,
        time: testCase.hasEndedTiming ? { start: 1, end: 2 } : { start: 1 },
      });
      const mapped = mapPartToAgentStreamPart(part);

      expect(mapped).toBeTruthy();
      if (mapped?.kind !== "tool") {
        throw new Error("Expected mapped tool part.");
      }
      expect(mapped.status).toBe(testCase.expectedStatus);
    }
  });

  test("returns null for unsupported part type", () => {
    const part = {
      id: "unknown-1",
      sessionID: "session-1",
      messageID: "assistant-1",
      type: "unknown",
    } as unknown as Part;

    expect(mapPartToAgentStreamPart(part)).toBeNull();
  });
});

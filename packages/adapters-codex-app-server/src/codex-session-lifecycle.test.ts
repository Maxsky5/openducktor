import { describe, expect, test } from "bun:test";
import type { AgentSessionRuntimeRef, ResumeAgentSessionInput } from "@openducktor/core";
import {
  sessionStateFromThreadRestore,
  sessionStateFromThreadResume,
} from "./codex-session-lifecycle";
import type { CodexThreadResumeResult } from "./types";

const threadResumeResponse: CodexThreadResumeResult = {
  thread: {
    id: "thread-1",
    cwd: "/repo",
    createdAt: 1_778_112_000,
    preview: "Existing Codex session",
    status: { type: "active", activeFlags: [] },
  },
};

describe("codex session lifecycle", () => {
  test("keeps restore state free of local live status", () => {
    const sharedInput = {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "planner",
      systemPrompt: "Follow the plan.",
      externalSessionId: "thread-1",
    } satisfies ResumeAgentSessionInput;
    const model = { providerId: "openai", modelId: "gpt-5", variant: "medium" } as const;

    const resumed = sessionStateFromThreadResume(
      sharedInput,
      "runtime-1",
      model,
      threadResumeResponse,
    );
    const restored = sessionStateFromThreadRestore(
      sharedInput satisfies AgentSessionRuntimeRef,
      "runtime-1",
      model,
      threadResumeResponse,
    );

    expect(resumed).toMatchObject({
      role: "planner",
      runtimeId: "runtime-1",
      repoPath: "/repo",
      threadId: "thread-1",
      workingDirectory: "/repo",
      taskId: "task-1",
      model,
      summary: {
        externalSessionId: "thread-1",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        role: "planner",
        status: "running",
      },
      liveStatus: {
        classification: "running",
      },
    });
    expect(restored).toMatchObject({
      role: "planner",
      runtimeId: "runtime-1",
      repoPath: "/repo",
      threadId: "thread-1",
      workingDirectory: "/repo",
      taskId: "task-1",
      model,
      summary: {
        externalSessionId: "thread-1",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        role: "planner",
        status: "running",
      },
    });
    expect(restored.liveStatus).toBeUndefined();
  });

  test("preserves restore-specific optional model absence", () => {
    const input = {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "qa",
      systemPrompt: "Review the work.",
      externalSessionId: "thread-1",
    } satisfies AgentSessionRuntimeRef;

    const restored = sessionStateFromThreadRestore(input, "runtime-1", undefined, {
      ...threadResumeResponse,
      startedAt: "2026-05-07T00:00:00.000Z",
    });

    expect(restored.model).toBeUndefined();
    expect(restored.summary.startedAt).toBe("2026-05-07T00:00:00.000Z");
    expect(restored.liveStatus).toBeUndefined();
  });
});

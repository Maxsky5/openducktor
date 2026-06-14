import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "./messages";
import {
  resolveRuntimeWorkingDirectoryRefState,
  toPersistedRuntimeSessionRef,
  toRuntimeSessionRef,
} from "./session-runtime-ref";

const sessionFixture = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "session-1",
  taskId: "task-1",
  runtimeKind: "codex",
  role: "build",
  status: "idle",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/repo/worktree",
  messages: createSessionMessagesState(overrides.externalSessionId ?? "session-1"),
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
  historyLoadState: "not_requested",
  ...overrides,
});

const persistedRecordFixture = (
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord => ({
  externalSessionId: "session-1",
  runtimeKind: "codex",
  role: "build",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/repo/worktree",
  selectedModel: null,
  ...overrides,
});

describe("resolveRuntimeWorkingDirectoryRefState", () => {
  test("returns no ref state when there is no active session", () => {
    expect(resolveRuntimeWorkingDirectoryRefState({ repoPath: "/repo", session: null })).toEqual({
      runtimeRef: null,
      runtimeRefError: null,
    });
  });

  test("builds the runtime working-directory ref from active session runtime context", () => {
    expect(
      resolveRuntimeWorkingDirectoryRefState({
        repoPath: " /repo ",
        session: {
          runtimeKind: "codex",
          workingDirectory: " /repo/worktree ",
        },
      }),
    ).toEqual({
      runtimeRef: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      },
      runtimeRefError: null,
    });
  });

  test("fails active session runtime context when the working directory is missing", () => {
    expect(
      resolveRuntimeWorkingDirectoryRefState({
        repoPath: "/repo",
        session: {
          runtimeKind: "codex",
          workingDirectory: "   ",
        },
      }),
    ).toEqual({
      runtimeRef: null,
      runtimeRefError: "Session workingDirectory is required to read active session runtime data.",
    });
  });
});

describe("runtime session refs", () => {
  test("builds session refs from mandatory session runtime metadata", () => {
    expect(
      toRuntimeSessionRef(" /repo ", sessionFixture({ workingDirectory: " /repo/wt " })),
    ).toEqual({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo/wt",
      externalSessionId: "session-1",
    });
  });

  test("fails fast when a session working directory is missing", () => {
    expect(() => toRuntimeSessionRef("/repo", sessionFixture({ workingDirectory: " " }))).toThrow(
      "Session workingDirectory is required to reach session 'session-1'.",
    );
  });

  test("builds persisted session refs from mandatory persisted runtime metadata", () => {
    expect(
      toPersistedRuntimeSessionRef({
        repoPath: " /repo ",
        record: persistedRecordFixture({ workingDirectory: " /repo/wt " }),
      }),
    ).toEqual({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo/wt",
      externalSessionId: "session-1",
    });
  });
});

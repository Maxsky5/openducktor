import { describe, expect, test } from "bun:test";
import type { RuntimeKind } from "@openducktor/contracts";
import { resolveChatComposerPromptInputTarget } from "./chat-composer-prompt-input-target";

const session = (runtimeKind: RuntimeKind = "codex") => ({
  externalSessionId: "session-1",
  runtimeKind,
  workingDirectory: "/repo/worktree",
  status: "running" as const,
  pendingApprovals: [],
  pendingQuestions: [],
});

const summary = (runtimeKind: RuntimeKind = "codex") => ({
  externalSessionId: "session-1",
  runtimeKind,
  workingDirectory: "/repo/worktree",
});

describe("resolveChatComposerPromptInputTarget", () => {
  test("uses the loaded session working directory for session-scoped prompt inputs", () => {
    const target = resolveChatComposerPromptInputTarget({
      workspaceRepoPath: "/repo",
      activeSession: session(),
      activeSessionSummary: summary("opencode"),
      selectedRuntimeKind: "opencode",
    });

    expect(target).toEqual({
      kind: "session",
      runtimeRef: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      },
    });
  });

  test("keeps summary-only and starting sessions in an explicit loading state", () => {
    const summaryTarget = resolveChatComposerPromptInputTarget({
      workspaceRepoPath: "/repo",
      activeSession: null,
      activeSessionSummary: summary(),
      selectedRuntimeKind: "opencode",
    });
    const startingTarget = resolveChatComposerPromptInputTarget({
      workspaceRepoPath: "/repo",
      activeSession: { ...session(), status: "starting" },
      activeSessionSummary: summary(),
      selectedRuntimeKind: "opencode",
    });

    expect(summaryTarget).toEqual({ kind: "sessionLoading", runtimeKind: "codex" });
    expect(startingTarget).toEqual({ kind: "sessionLoading", runtimeKind: "codex" });
  });

  test("keeps waiting-input sessions usable even when their raw status is starting", () => {
    const target = resolveChatComposerPromptInputTarget({
      workspaceRepoPath: "/repo",
      activeSession: {
        ...session(),
        status: "starting",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [],
          },
        ],
      },
      activeSessionSummary: null,
      selectedRuntimeKind: "opencode",
    });

    expect(target).toEqual({
      kind: "session",
      runtimeRef: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      },
    });
  });

  test("uses repo runtime inputs before a session exists", () => {
    const target = resolveChatComposerPromptInputTarget({
      workspaceRepoPath: "/repo",
      activeSession: null,
      activeSessionSummary: null,
      selectedRuntimeKind: "opencode",
    });

    expect(target).toEqual({
      kind: "repo",
      repoPath: "/repo",
      runtimeKind: "opencode",
    });
  });

  test("reports missing repo and runtime as explicit target states", () => {
    const noRepoTarget = resolveChatComposerPromptInputTarget({
      workspaceRepoPath: null,
      activeSession: null,
      activeSessionSummary: null,
      selectedRuntimeKind: "opencode",
    });
    const noRuntimeTarget = resolveChatComposerPromptInputTarget({
      workspaceRepoPath: "/repo",
      activeSession: null,
      activeSessionSummary: null,
      selectedRuntimeKind: null,
    });

    expect(noRepoTarget).toEqual({ kind: "noRepo" });
    expect(noRuntimeTarget).toEqual({ kind: "noRuntime", repoPath: "/repo" });
  });
});

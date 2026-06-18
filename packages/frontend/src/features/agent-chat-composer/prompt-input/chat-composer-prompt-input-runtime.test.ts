import { describe, expect, test } from "bun:test";
import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { ChatComposerPromptInputRuntimeSource } from "./chat-composer-prompt-input-runtime";
import { resolveChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";

const sessionIdentity = (runtimeKind: RuntimeKind = "codex"): AgentSessionIdentity => ({
  externalSessionId: "session-1",
  runtimeKind,
  workingDirectory: "/repo/worktree",
});

const sessionSource = (
  session: AgentSessionIdentity = sessionIdentity(),
): ChatComposerPromptInputRuntimeSource => ({ kind: "session", session });

const repoSource = (
  runtimeKind: RuntimeKind | null = "opencode",
): ChatComposerPromptInputRuntimeSource => ({ kind: "repo", runtimeKind });

describe("resolveChatComposerPromptInputRuntime", () => {
  test("uses the loaded session working directory for session-scoped prompt inputs", () => {
    const runtime = resolveChatComposerPromptInputRuntime({
      workspaceRepoPath: "/repo",
      repoReadinessState: "ready",
      source: sessionSource(),
    });

    expect(runtime).toEqual({
      state: "available",
      scope: "session",
      runtimeRef: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      },
    });
  });

  test("waits for selected-session prompt inputs until the selected runtime is ready", () => {
    const checkingRuntime = resolveChatComposerPromptInputRuntime({
      workspaceRepoPath: "/repo",
      repoReadinessState: "checking",
      source: sessionSource(),
    });
    const blockedRuntime = resolveChatComposerPromptInputRuntime({
      workspaceRepoPath: "/repo",
      repoReadinessState: "blocked",
      source: sessionSource(),
    });

    expect(checkingRuntime).toEqual({
      state: "waiting",
      runtimeKind: "codex",
      message: "File search is unavailable until the runtime is ready.",
    });
    expect(blockedRuntime).toEqual({
      state: "waiting",
      runtimeKind: "codex",
      message: "File search is unavailable until the runtime is ready.",
    });
  });

  test("keeps waiting-input sessions usable even when their raw status is starting", () => {
    const runtime = resolveChatComposerPromptInputRuntime({
      workspaceRepoPath: "/repo",
      repoReadinessState: "ready",
      source: sessionSource(),
    });

    expect(runtime).toEqual({
      state: "available",
      scope: "session",
      runtimeRef: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      },
    });
  });

  test("reports invalid selected session runtime context as unavailable", () => {
    const runtime = resolveChatComposerPromptInputRuntime({
      workspaceRepoPath: null,
      repoReadinessState: "ready",
      source: sessionSource(),
    });

    expect(runtime).toEqual({
      state: "unavailable",
      runtimeKind: "codex",
      error: "Repository path is required to read selected session runtime data.",
    });
  });

  test("fails fast when a selected session has an invalid working directory", () => {
    expect(() =>
      resolveChatComposerPromptInputRuntime({
        workspaceRepoPath: "/repo",
        repoReadinessState: "ready",
        source: sessionSource({
          ...sessionIdentity(),
          workingDirectory: "",
        }),
      }),
    ).toThrow("read selected session runtime data");
  });

  test("uses repo runtime inputs before a session exists", () => {
    const runtime = resolveChatComposerPromptInputRuntime({
      workspaceRepoPath: "/repo",
      repoReadinessState: "ready",
      source: repoSource(),
    });

    expect(runtime).toEqual({
      state: "available",
      scope: "repo",
      runtimeRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
      },
    });
  });

  test("waits for repo-scoped prompt inputs until the selected runtime is ready", () => {
    const runtime = resolveChatComposerPromptInputRuntime({
      workspaceRepoPath: "/repo",
      repoReadinessState: "checking",
      source: repoSource(),
    });

    expect(runtime).toEqual({
      state: "waiting",
      runtimeKind: "opencode",
      message: "File search is unavailable until the runtime is ready.",
    });
  });

  test("reports missing repo and runtime as unavailable runtime input", () => {
    const missingRepoRuntime = resolveChatComposerPromptInputRuntime({
      workspaceRepoPath: null,
      repoReadinessState: "ready",
      source: repoSource(),
    });
    const missingRuntime = resolveChatComposerPromptInputRuntime({
      workspaceRepoPath: "/repo",
      repoReadinessState: "ready",
      source: repoSource(null),
    });

    expect(missingRepoRuntime).toEqual({
      state: "unavailable",
      runtimeKind: null,
      error: "No repository selected.",
    });
    expect(missingRuntime).toEqual({
      state: "unavailable",
      runtimeKind: null,
      error: "Select a runtime before using prompt input.",
    });
  });
});

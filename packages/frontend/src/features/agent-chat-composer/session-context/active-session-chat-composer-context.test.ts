import { describe, expect, test } from "bun:test";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import {
  type ActiveSessionChatComposerSession,
  type ActiveSessionChatComposerSummary,
  resolveActiveSessionChatComposerContext,
} from "./active-session-chat-composer-context";

const makeSummary = (): ActiveSessionChatComposerSummary => ({
  externalSessionId: "external-1",
  status: "idle",
  workingDirectory: "/repo",
  runtimeKind: "opencode",
  selectedModel: {
    runtimeKind: "opencode",
    providerId: "anthropic",
    modelId: "claude-sonnet",
    profileId: "build-agent",
  },
});

const makeLoadedSession = (): ActiveSessionChatComposerSession => ({
  externalSessionId: "external-1",
  status: "idle",
  selectedModel: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
    profileId: "spec-agent",
  },
  runtimeKind: "opencode",
  workingDirectory: "/repo/session-worktree",
  contextUsage: null,
  messages: createSessionMessagesState("external-1"),
});

describe("active-session-chat-composer-context", () => {
  test("prefers loaded session runtime fields while preserving summary selection fallback", () => {
    const loadedSession = makeLoadedSession();
    const state = resolveActiveSessionChatComposerContext(loadedSession, makeSummary());

    expect(state.externalSessionId).toBe("external-1");
    expect(state.selectedModel).toEqual(loadedSession.selectedModel);
    expect(state.runtimeKind).toBe("opencode");
    expect(state.workingDirectory).toBe("/repo/session-worktree");
    expect(state.source).toBe("loaded");
  });

  test("keeps summary selection available while the loaded session is missing", () => {
    const summary = makeSummary();
    const state = resolveActiveSessionChatComposerContext(null, summary);

    expect(state.externalSessionId).toBe("external-1");
    expect(state.selectedModel).toEqual(summary.selectedModel);
    expect(state.runtimeKind).toBe("opencode");
    expect(state.workingDirectory).toBe("/repo");
    expect(state.source).toBe("summary");
  });

  test("keeps the no-session composer context explicit", () => {
    const state = resolveActiveSessionChatComposerContext(null, null);

    expect(state).toMatchObject({
      source: "none",
      externalSessionId: null,
      status: null,
      selectedModel: null,
      runtimeKind: null,
      workingDirectory: "",
      liveContextUsage: null,
      messages: null,
    });
  });
});

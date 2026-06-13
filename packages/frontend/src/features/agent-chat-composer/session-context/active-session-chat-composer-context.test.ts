import { describe, expect, test } from "bun:test";
import {
  type ActiveSessionChatComposerSession,
  type ActiveSessionChatComposerSummary,
  resolveActiveSessionChatComposerContext,
} from "./active-session-chat-composer-context";

const makeSummary = (): ActiveSessionChatComposerSummary => ({
  externalSessionId: "external-1",
  repoPath: "/repo",
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

const makeHydratedSession = (): ActiveSessionChatComposerSession => ({
  externalSessionId: "external-1",
  repoPath: "/repo",
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
  messages: [],
});

describe("active-session-chat-composer-context", () => {
  test("prefers hydrated session runtime fields while preserving summary selection fallback", () => {
    const hydratedSession = makeHydratedSession();
    const state = resolveActiveSessionChatComposerContext(hydratedSession, makeSummary());

    expect(state.externalSessionId).toBe("external-1");
    expect(state.selectedModel).toEqual(hydratedSession.selectedModel);
    expect(state.runtimeKind).toBe("opencode");
    expect(state.workingDirectory).toBe("/repo/session-worktree");
    expect(state.hasActiveSession).toBe(true);
  });

  test("keeps summary selection available while the hydrated session is missing", () => {
    const summary = makeSummary();
    const state = resolveActiveSessionChatComposerContext(null, summary);

    expect(state.externalSessionId).toBe("external-1");
    expect(state.selectedModel).toEqual(summary.selectedModel);
    expect(state.runtimeKind).toBe("opencode");
    expect(state.workingDirectory).toBe("/repo");
    expect(state.hasActiveSession).toBe(true);
  });
});

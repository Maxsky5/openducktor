import { describe, expect, test } from "bun:test";
import {
  type ActiveSessionChatComposerSession,
  type ActiveSessionChatComposerSummary,
  resolveActiveSessionChatComposerTarget,
} from "./active-session-chat-composer-target";

const makeSummary = (): ActiveSessionChatComposerSummary => ({
  externalSessionId: "external-1",
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
  selectedModel: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
    profileId: "spec-agent",
  },
  runtimeKind: "opencode",
  workingDirectory: "/repo/session-worktree",
});

describe("active-session-chat-composer-target", () => {
  test("prefers loaded session identity for the composer target", () => {
    const loadedSession = makeLoadedSession();
    const target = resolveActiveSessionChatComposerTarget(loadedSession, makeSummary());

    expect(target.selectedModel).toEqual(loadedSession.selectedModel);
    expect(target.sessionIdentity).toEqual({
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/session-worktree",
    });
    expect(target.source).toBe("loaded");
  });

  test("keeps summary selection available as target identity only", () => {
    const summary = makeSummary();
    const target = resolveActiveSessionChatComposerTarget(null, summary);

    expect(target.selectedModel).toEqual(summary.selectedModel);
    expect(target.sessionIdentity).toEqual({
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
    });
    expect(target.source).toBe("summary");
  });

  test("does not hide loaded-session identity behind the summary", () => {
    const target = resolveActiveSessionChatComposerTarget(
      {
        ...makeLoadedSession(),
        workingDirectory: "/repo/loaded-session",
      },
      makeSummary(),
    );

    expect(target.source).toBe("loaded");
    expect(target.sessionIdentity).toEqual({
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/loaded-session",
    });
  });

  test("keeps the no-session composer context explicit", () => {
    const target = resolveActiveSessionChatComposerTarget(null, null);

    expect(target).toMatchObject({
      source: "none",
      selectedModel: null,
      sessionIdentity: null,
    });
  });
});

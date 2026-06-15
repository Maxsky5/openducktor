import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  clearAllSessionTransientState,
  clearSessionTransientState,
  createSessionDraftBuffers,
  createSessionTurnMetadata,
  createSessionTurnTiming,
  type SessionTransientState,
} from "./session-transient-state";

const createTransientState = (): SessionTransientState => ({
  draftBuffers: createSessionDraftBuffers(),
  assistantTurnTiming: createSessionTurnTiming(),
  turnMetadata: createSessionTurnMetadata(),
});

const session = (externalSessionId: string): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
});

describe("session-transient-state", () => {
  test("clears every transient map for one session identity", () => {
    const state = createTransientState();
    const target = session("external-1");
    const other = session("external-2");
    const targetKey = agentSessionIdentityKey(target);
    const otherKey = agentSessionIdentityKey(other);

    state.draftBuffers.writeChannel(targetKey, "reasoning", {
      raw: "draft",
      source: "delta",
      messageId: "message-1",
    });
    state.assistantTurnTiming.recordTurnUserMessageTimestamp(targetKey, 1);
    state.turnMetadata.recordModel(targetKey, {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    });
    state.turnMetadata.recordModel(otherKey, null);

    clearSessionTransientState(state, target);

    expect(state.draftBuffers.readChannel(targetKey, "reasoning")).toEqual({ raw: "" });
    expect(state.assistantTurnTiming.readTurnUserMessageStartedAtMs(targetKey)).toBeUndefined();
    expect(state.turnMetadata.readModel(targetKey)).toBeUndefined();
    expect(state.turnMetadata.readModel(otherKey)).toBeNull();

    clearSessionTransientState(state, other);
  });

  test("clears all transient session maps", () => {
    const state = createTransientState();
    const key = agentSessionIdentityKey(session("external-1"));

    state.draftBuffers.writeChannel(key, "reasoning", {
      raw: "draft",
      source: "delta",
      messageId: "message-1",
    });
    state.assistantTurnTiming.recordTurnUserMessageTimestamp(key, 1);
    state.turnMetadata.recordModel(key, null);

    clearAllSessionTransientState(state);

    expect(state.draftBuffers.readChannel(key, "reasoning")).toEqual({ raw: "" });
    expect(state.assistantTurnTiming.readTurnUserMessageStartedAtMs(key)).toBeUndefined();
    expect(state.turnMetadata.readModel(key)).toBeUndefined();
  });
});

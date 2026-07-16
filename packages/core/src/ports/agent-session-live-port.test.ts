import { describe, expect, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLivePort,
  AgentSessionLiveSnapshot,
} from "../index";

const snapshot: AgentSessionLiveSnapshot = {
  ref: {
    repoPath: "/repo",
    runtimeKind: "codex",
    workingDirectory: "/repo/worktree",
    externalSessionId: "thread-1",
  },
  activity: "idle",
  title: "Thread 1",
  startedAt: "2026-07-16T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
};

describe("AgentSessionLivePort", () => {
  test("stands alone from runtime history and routes normalized operations", async () => {
    const envelopes: AgentSessionLiveEnvelope[] = [];
    const calls: string[] = [];
    const port: AgentSessionLivePort = {
      async listLiveSessions() {
        calls.push("list");
        return [snapshot];
      },
      async readLiveSession() {
        calls.push("read");
        return { type: "live", session: snapshot };
      },
      async attachLiveSessions(input, listener) {
        calls.push(`attach:${input.attachmentId}`);
        listener({ type: "snapshot", attachmentId: input.attachmentId, sessions: [snapshot] });
        return () => {
          calls.push(`unsubscribe:${input.attachmentId}`);
        };
      },
      async detachLiveSessions(input) {
        calls.push(`detach:${input.attachmentId}`);
      },
      async loadLiveSessionContext() {
        calls.push("context");
        return null;
      },
      async replyLiveSessionApproval(input) {
        calls.push(`approval:${input.requestId}`);
      },
      async replyLiveSessionQuestion(input) {
        calls.push(`question:${input.requestId}`);
      },
    };

    expect(await port.listLiveSessions({ repoPath: "/repo" })).toEqual([snapshot]);
    expect(await port.readLiveSession(snapshot.ref)).toEqual({ type: "live", session: snapshot });
    const unsubscribe = await port.attachLiveSessions(
      { attachmentId: "attachment-1", repoPath: "/repo" },
      (envelope) => envelopes.push(envelope),
    );
    unsubscribe();
    await port.detachLiveSessions({ attachmentId: "attachment-1" });
    expect(await port.loadLiveSessionContext(snapshot.ref)).toBeNull();
    await port.replyLiveSessionApproval({
      ...snapshot.ref,
      requestId: "opaque-approval",
      outcome: "approve_once",
    });
    await port.replyLiveSessionQuestion({
      ...snapshot.ref,
      requestId: "opaque-question",
      answers: [["Yes"]],
    });

    expect(envelopes).toEqual([
      { type: "snapshot", attachmentId: "attachment-1", sessions: [snapshot] },
    ]);
    expect(calls).toEqual([
      "list",
      "read",
      "attach:attachment-1",
      "unsubscribe:attachment-1",
      "detach:attachment-1",
      "context",
      "approval:opaque-approval",
      "question:opaque-question",
    ]);
    expect("loadSessionHistory" in port).toBe(false);
  });
});

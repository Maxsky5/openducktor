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
      async observeLiveSessions(input, listener) {
        calls.push(`observe:${input.repoPath}`);
        listener({ type: "snapshot", repoPath: input.repoPath, sessions: [snapshot] });
        return () => {
          calls.push(`unsubscribe:${input.repoPath}`);
        };
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
    const unsubscribe = await port.observeLiveSessions({ repoPath: "/repo" }, (envelope) =>
      envelopes.push(envelope),
    );
    unsubscribe();
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

    expect(envelopes).toEqual([{ type: "snapshot", repoPath: "/repo", sessions: [snapshot] }]);
    expect(calls).toEqual([
      "list",
      "read",
      "observe:/repo",
      "unsubscribe:/repo",
      "context",
      "approval:opaque-approval",
      "question:opaque-question",
    ]);
    expect("loadSessionHistory" in port).toBe(false);
  });
});

import { expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { replaceAgentSession } from "@/state/agent-session-collection";
import {
  applyAgentSessionLiveDelta,
  buildAgentSessionLiveCollection,
} from "../session-read-model/agent-session-live-projection";
import { createOpenCodeAgentEngineTestAdapter } from "./opencode-agent-engine.test-support";
import { acceptedUserMessage } from "./session-actions-send.test-support";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
} from "./session-actions.test-helpers";

test.each(["opencode", "codex", "claude"] as const)(
  "resumes a stopped %s repository session before sending",
  async (runtimeKind) => {
    for (const waitingInput of [false, true]) {
      const session = buildSession({
        runtimeKind,
        sessionAssociation: { kind: "repository" },
        executionEpisodeId: "episode-1",
        historyLoadState: "loaded",
        pendingQuestions: waitingInput ? [{ requestId: "question-1", questions: [] }] : [],
      });
      const sessionsRef = createSessionsRef([session]);
      const calls: string[] = [];
      const adapter = createOpenCodeAgentEngineTestAdapter(new OpencodeSdkAdapter());
      adapter.stopSession = async () => {
        calls.push("stop");
      };
      adapter.resumeSession = async (input) => {
        calls.push("resume");
        expect(input).toEqual({
          repoPath: "/tmp/repo",
          runtimeKind,
          workingDirectory: session.workingDirectory,
          externalSessionId: session.externalSessionId,
          sessionScope: { kind: "repository" },
          resumeMode: "reattach",
        });
        return { ...session, status: "idle" };
      };
      adapter.sendUserMessage = async (input) => {
        calls.push("send");
        return acceptedUserMessage(input);
      };
      const actions = createSessionActions({ adapter, sessionsRef, taskRef: { current: [] } });
      await actions.stopAgentSession(session);
      const snapshot: AgentSessionLiveSnapshot = {
        ref: {
          repoPath: "/tmp/repo",
          runtimeKind,
          workingDirectory: session.workingDirectory,
          externalSessionId: session.externalSessionId,
        },
        executionEpisodeId: "episode-1",
        activity: "idle",
        title: "Chat",
        startedAt: session.startedAt,
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: null,
      };
      sessionsRef.current = applyAgentSessionLiveDelta({
        current: sessionsRef.current,
        envelope: { type: "session_upsert", session: snapshot },
      });
      sessionsRef.current = buildAgentSessionLiveCollection({
        current: sessionsRef.current,
        snapshots: [snapshot],
      });
      expect(getSession(sessionsRef).status).toBe("stopped");
      await actions.sendAgentMessage(session, [{ kind: "text", text: "Continue" }]);
      expect(calls).toEqual(["stop", "resume", "send"]);
      expect(getSession(sessionsRef).status).toBe("running");
    }
  },
);

test.each(["opencode", "codex", "claude"] as const)(
  "resumes a stopped %s workflow session before sending",
  async (runtimeKind) => {
    const session = buildSession({
      runtimeKind,
      status: "stopped",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    });
    const sessionsRef = createSessionsRef([session]);
    const calls: string[] = [];
    const adapter = createOpenCodeAgentEngineTestAdapter(new OpencodeSdkAdapter());
    adapter.resumeSession = async (input) => {
      calls.push("resume");
      expect(input).toEqual({
        repoPath: "/tmp/repo",
        runtimeKind,
        workingDirectory: session.workingDirectory,
        externalSessionId: session.externalSessionId,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        resumeMode: "reattach",
      });
      return { ...session, status: "idle" };
    };
    adapter.sendUserMessage = async (input) => {
      calls.push("send");
      return acceptedUserMessage(input);
    };

    const actions = createSessionActions({ adapter, sessionsRef });
    await actions.sendAgentMessage(session, [{ kind: "text", text: "Continue" }]);

    expect(calls).toEqual(["resume", "send"]);
    expect(getSession(sessionsRef).status).toBe("running");
  },
);

test("does not send or erase the stopped state when resume fails", async () => {
  const session = buildSession({ status: "stopped", sessionAssociation: { kind: "repository" } });
  const sessionsRef = createSessionsRef([session]);
  const adapter = createOpenCodeAgentEngineTestAdapter(new OpencodeSdkAdapter());
  adapter.resumeSession = async () => {
    throw new Error("Resume failed");
  };
  let sends = 0;
  adapter.sendUserMessage = async (input) => {
    sends++;
    return acceptedUserMessage(input);
  };
  const actions = createSessionActions({ adapter, sessionsRef });
  await expect(
    actions.sendAgentMessage(session, [{ kind: "text", text: "Continue" }]),
  ).rejects.toThrow("Resume failed");
  expect(sends).toBe(0);
  expect(getSession(sessionsRef).status).toBe("stopped");
});

test("does not overwrite a newer question that arrives during resume", async () => {
  const session = buildSession({
    status: "stopped",
    executionEpisodeId: "old",
    sessionAssociation: { kind: "repository" },
  });
  const sessionsRef = createSessionsRef([session]);
  const adapter = createOpenCodeAgentEngineTestAdapter(new OpencodeSdkAdapter());
  adapter.resumeSession = async () => {
    sessionsRef.current = replaceAgentSession(sessionsRef.current, {
      ...getSession(sessionsRef),
      status: "running",
      executionEpisodeId: "new",
      pendingQuestions: [{ requestId: "question-2", questions: [] }],
    });
    return { ...session, status: "idle" };
  };
  let sends = 0;
  adapter.sendUserMessage = async (input) => {
    sends++;
    return acceptedUserMessage(input);
  };
  const actions = createSessionActions({ adapter, sessionsRef });
  await expect(
    actions.sendAgentMessage(session, [{ kind: "text", text: "Continue" }]),
  ).rejects.toThrow("Answer or reject the blocking request first");
  expect(sends).toBe(0);
  expect(getSession(sessionsRef)).toMatchObject({
    status: "running",
    executionEpisodeId: "new",
    pendingQuestions: [{ requestId: "question-2", questions: [] }],
  });
});

test.each(["workspace-change", "wrong-session", "still-stopped"] as const)(
  "does not send after a resume with %s",
  async (outcome) => {
    const session = buildSession({ status: "stopped", sessionAssociation: { kind: "repository" } });
    const sessionsRef = createSessionsRef([session]);
    const repoEpochRef = { current: 1 };
    const adapter = createOpenCodeAgentEngineTestAdapter(new OpencodeSdkAdapter());
    adapter.resumeSession = async () => {
      if (outcome === "workspace-change") repoEpochRef.current++;
      return {
        ...session,
        externalSessionId:
          outcome === "wrong-session" ? "other-session" : session.externalSessionId,
        status: outcome === "still-stopped" ? "stopped" : "idle",
      };
    };
    let sends = 0;
    adapter.sendUserMessage = async (input) => {
      sends++;
      return acceptedUserMessage(input);
    };
    const actions = createSessionActions({ adapter, sessionsRef, repoEpochRef });
    const errors = {
      "workspace-change": "Workspace changed while resuming the session.",
      "wrong-session": "The runtime resumed a different session",
      "still-stopped": "is still stopped after resume",
    };
    await expect(
      actions.sendAgentMessage(session, [{ kind: "text", text: "Continue" }]),
    ).rejects.toThrow(errors[outcome]);
    expect(sends).toBe(0);
    expect(getSession(sessionsRef).status).toBe("stopped");
  },
);

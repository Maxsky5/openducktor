import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { createAgentSessionCollection, getAgentSession } from "@/state/agent-session-collection";
import { applyAgentSessionLiveDelta } from "./agent-session-live-projection";
import { projectSessionTranscriptActivity } from "./agent-session-live-activity";

describe("ordered session execution episodes", () => {
  for (const sessionAssociation of [
    { kind: "repository" },
    { kind: "workflow", taskId: "task-1", role: "build" },
  ] as const) {
    test.each(["stopped", "error"] as const)(
      `${sessionAssociation.kind} accepts a new episode after %s`,
      (status) => {
        const session = createAgentSessionFixture({
          sessionAssociation,
          status,
          executionEpisodeId: "old",
        });
        const ref = {
          repoPath: "/repo",
          runtimeKind: session.runtimeKind,
          workingDirectory: session.workingDirectory,
          externalSessionId: session.externalSessionId,
        };
        const current = createAgentSessionCollection([session]);
        const snapshot: AgentSessionLiveSnapshot = {
          ref,
          activity: "idle",
          executionEpisodeId: "new",
          title: "Session",
          startedAt: session.startedAt,
          pendingApprovals: [],
          pendingQuestions: [],
          pendingAsyncQuestions: [],
          contextUsage: null,
        };
        const next = applyAgentSessionLiveDelta({
          current,
          envelope: { type: "session_upsert", session: snapshot },
        });
        expect(getAgentSession(next, ref)).toMatchObject({
          status: "idle",
          executionEpisodeId: "new",
        });
      },
    );
    test.each(["stopped", "error"] as const)(
      `${sessionAssociation.kind} shows current pending input after %s`,
      (status) => {
        const session = createAgentSessionFixture({
          sessionAssociation,
          status,
          executionEpisodeId: "same",
        });
        const ref = {
          repoPath: "/repo",
          runtimeKind: session.runtimeKind,
          workingDirectory: session.workingDirectory,
          externalSessionId: session.externalSessionId,
        };
        const snapshot: AgentSessionLiveSnapshot = {
          ref,
          activity: "waiting_for_permission",
          executionEpisodeId: "same",
          title: "Session",
          startedAt: session.startedAt,
          pendingApprovals: [
            { requestId: "permission", requestType: "command_execution", title: "Run" },
          ],
          pendingQuestions: [{ requestId: "question", questions: [] }],
          pendingAsyncQuestions: [],
          contextUsage: null,
        };
        const next = applyAgentSessionLiveDelta({
          current: createAgentSessionCollection([session]),
          envelope: { type: "session_upsert", session: snapshot },
        });
        expect(getAgentSession(next, ref)).toMatchObject({
          status: "idle",
          pendingApprovals: snapshot.pendingApprovals,
          pendingQuestions: snapshot.pendingQuestions,
        });
      },
    );
  }
  test("keeps the same state object for stream chunks with no activity change", () => {
    const session = createAgentSessionFixture({ status: "running", runtimeStatusMessage: null });
    expect(
      projectSessionTranscriptActivity(session, {
        type: "assistant_delta",
        channel: "text",
        messageId: "message",
        delta: "next",
        externalSessionId: session.externalSessionId,
        timestamp: "2026-09-12T12:00:00Z",
      }),
    ).toBe(session);
  });
});

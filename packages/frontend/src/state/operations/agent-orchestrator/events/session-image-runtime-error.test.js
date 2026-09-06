import { expect, test } from "bun:test";
import {
  codexStartSessionInput,
  codexTurnFixture,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
  makeRuntimeSummary,
} from "../../../../../../adapters-codex-app-server/src/codex-app-server-adapter.test-harness";
import { getAgentSession } from "@/state/agent-session-collection";
import { createSessionTurnState } from "../support/session-turn-state";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  getSession,
  getSessionMessages,
} from "./session-events-test-harness";
import { createAgentSessionTranscriptEventConsumer } from "./session-transcript-events";

for (const request of [
  {
    id: 71,
    method: "item/tool/requestUserInput",
    params: { turnId: "turn", itemId: "tool", questions: [] },
    error: "threadId",
  },
  { id: 72, method: "attestation/generate", params: {}, error: "missing a thread identifier" },
  {
    id: 73,
    method: "item/tool/call",
    params: {
      arguments: {},
      callId: "call",
      namespace: null,
      threadId: "thread/start-affected",
      tool: "test_tool",
      turnId: "turn",
    },
    error: "Rejected Codex dynamic tool request",
  },
]) {
  test(`${request.method} error settles only images in the failed runtime before session error`, async () => {
    const stream = createRuntimeStreamSubscription();
    const runtimeIds = ["other", "affected"];
    const sessionsRef = createSessionsRef(
      runtimeIds.map((runtimeId) =>
        buildSession({
          runtimeKind: "codex",
          repoPath: "/repo",
          workingDirectory: "/repo",
          externalSessionId: `thread/start-${runtimeId}`,
          status: "running",
        }),
      ),
    );
    const consumer = createAgentSessionTranscriptEventConsumer(
      {
        readSession: (identity) => getAgentSession(sessionsRef.current, identity),
        ensureSession: (_identity, create) => create(),
        updateSession: createSessionUpdater(sessionsRef),
        updateSessionTodos: () => {},
        sessionTurnState: createSessionTurnState(),
      },
      { batchWindowMs: 0 },
    );
    const events = [];
    let runtimeId = "other";
    const { adapter } = createHarness({
      subscribeEvents: stream.subscribeEvents,
      repoRuntimeResolver: { requireRepoRuntime: async () => makeRuntimeSummary(runtimeId) },
      onLiveSessionMutation: (mutation) => {
        for (const event of mutation.transcriptEvents) {
          events.push(event);
          consumer.handle(event);
        }
      },
    });
    const notifyImage = (threadId, id, status, turnId = "turn") => {
      stream.emitNotification({
        method: status === "completed" ? "item/completed" : "item/started",
        params: {
          threadId,
          turnId,
          startedAtMs: Date.now(),
          completedAtMs: Date.now(),
          item: {
            type: "imageGeneration",
            id,
            status,
            revisedPrompt: "A duck",
            result: "",
            transparentBackground: null,
            failure: null,
          },
        },
      });
    };
    try {
      for (const id of runtimeIds) {
        runtimeId = id;
        const session = await adapter.startSession(codexStartSessionInput());
        stream.emitNotification({
          method: "turn/started",
          params: {
            threadId: session.externalSessionId,
            turn: codexTurnFixture({ id: "turn", status: "inProgress", items: [] }),
          },
        });
        await flushCodexAdapterWork();
        notifyImage(session.externalSessionId, "running", "in_progress");
        notifyImage(session.externalSessionId, "done", "completed");
        await flushCodexAdapterWork();
      }
      const affectedId = "thread/start-affected";
      expect(
        getSessionMessages(sessionsRef, affectedId).map((message) => message.meta?.status),
      ).toEqual(["running", "completed"]);
      stream.emitNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId: affectedId,
          turnId: "turn",
          itemId: "text",
          delta: "Keep this explanation.",
        },
      });
      await flushCodexAdapterWork();
      const otherBefore = getSession(sessionsRef, "thread/start-other");
      const eventCount = events.length;
      const { error, ...message } = request;
      stream.emitServerRequest(message);
      await flushCodexAdapterWork();
      expect(getSession(sessionsRef, affectedId).status).toBe("error");
      expect(
        getSessionMessages(sessionsRef, affectedId)
          .slice(0, 2)
          .map((message) => message.meta),
      ).toMatchObject([
        { status: "incomplete", incompleteReason: "runtime_failure", revisedPrompt: "A duck" },
        { status: "completed", revisedPrompt: "A duck" },
      ]);
      expect(
        getSessionMessages(sessionsRef, affectedId).some(
          (message) => message.content === "Keep this explanation.",
        ),
      ).toBe(true);
      expect(getSession(sessionsRef, "thread/start-other")).toBe(otherBefore);
      const failureEvents = events.slice(eventCount);
      expect(failureEvents.every((event) => event.externalSessionId === affectedId)).toBe(true);
      expect(failureEvents[0]).toMatchObject({
        type: "image_generation_settled",
        reason: "runtime_failure",
      });
      expect(failureEvents.at(-1)).toMatchObject({
        type: "session_error",
        message: expect.stringContaining(error),
      });
      notifyImage(affectedId, "running", "completed");
      await flushCodexAdapterWork();
      expect(getSessionMessages(sessionsRef, affectedId)[0]?.meta).toMatchObject({
        status: "completed",
      });
      stream.emitNotification({
        method: "turn/started",
        params: {
          threadId: affectedId,
          turn: codexTurnFixture({ id: "next", status: "inProgress", items: [] }),
        },
      });
      await flushCodexAdapterWork();
      notifyImage(affectedId, "new", "in_progress", "next");
      await flushCodexAdapterWork();
      expect(getSessionMessages(sessionsRef, affectedId).at(-1)?.meta).toMatchObject({
        status: "running",
        itemId: "new",
        turnId: "next",
      });
    } finally {
      for (const id of runtimeIds) adapter.releaseRuntime(id);
      consumer.close();
    }
  });
}

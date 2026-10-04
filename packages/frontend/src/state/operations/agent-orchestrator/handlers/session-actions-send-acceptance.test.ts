import { describe, expect, test } from "bun:test";
import { HostInvokeError } from "@openducktor/host-client";
import { replaceAgentSession } from "@/state/agent-session-collection";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import {
  createSessionUpdater as createEventSessionUpdater,
  listenToAgentSessionEvents,
} from "../events/session-events-test-harness";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
} from "./session-actions.test-helpers";
import {
  createOpenCodeAgentEngineTestAdapter,
  createTestOpencodeSdkAdapter,
} from "./opencode-agent-engine.test-support";
import { acceptedUserMessage } from "./session-actions-send.test-support";

describe("agent-orchestrator/handlers/session-actions send acceptance", () => {
  test.each(["event-first", "response-first"] as const)(
    "does not duplicate accepted queued input in %s order",
    async (order) => {
      const adapter = createTestOpencodeSdkAdapter();
      const handlers: Parameters<typeof adapter.subscribeEvents>[1][] = [];
      adapter.subscribeEvents = async (_ref, handler) => {
        handlers.push(handler);
        return () => {};
      };
      const event = acceptedUserMessage({
        externalSessionId: "session-1",
        parts: [{ kind: "text", text: "Hello" }],
      });
      const sessionsRef = createSessionsRef([
        buildSession({ status: "running", historyLoadState: "loaded", executionEpisodeId: "busy" }),
      ]);
      adapter.sendUserMessage = async (input) => {
        if (order === "event-first") for (const handler of handlers) handler(event);
        throw new HostInvokeError(
          "The runtime accepted the message, but the session update failed.",
          {
            kind: "agent_session_message_accepted",
            stage: "live_update",
            acceptedMessage: event,
            sessionRef: {
              repoPath: input.repoPath,
              runtimeKind: input.runtimeKind,
              workingDirectory: input.workingDirectory,
              externalSessionId: input.externalSessionId,
            },
          },
        );
      };
      const unsubscribe = await listenToAgentSessionEvents({
        adapter,
        sessionsRef,
        updateSession: createEventSessionUpdater(sessionsRef),
        externalSessionId: "session-1",
        repoPath: "/tmp/repo",
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => {},
      });
      try {
        const actions = createSessionActions({ adapter, sessionsRef });
        await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "Hello" }]);
        if (order === "response-first") for (const handler of handlers) handler(event);
        const current = getSession(sessionsRef);
        expect(
          sessionMessagesToArray(current).filter((message) => message.role === "user"),
        ).toHaveLength(1);
        expect(current).toMatchObject({ status: "running", executionEpisodeId: "busy" });
      } finally {
        unsubscribe();
      }
    },
  );
  test.each(["workflow", "repository"] as const)(
    "keeps an accepted %s message and a newer pending question after publication fails",
    async (kind) => {
      const adapter = createOpenCodeAgentEngineTestAdapter(createTestOpencodeSdkAdapter());
      const sessionsRef = createSessionsRef([
        buildSession({
          status: "idle",
          executionEpisodeId: "old",
          sessionAssociation:
            kind === "repository" ? { kind } : { kind, taskId: "task-1", role: "build" },
        }),
      ]);
      let sends = 0;
      adapter.sendUserMessage = async (input) => {
        sends += 1;
        const current = getSession(sessionsRef);
        sessionsRef.current = replaceAgentSession(sessionsRef.current, {
          ...current,
          executionEpisodeId: "new",
          status: "running",
          pendingQuestions: [{ requestId: "question-1", questions: [] }],
        });
        throw new HostInvokeError(
          "The runtime accepted the message, but the session update failed.",
          {
            kind: "agent_session_message_accepted",
            sessionRef: {
              repoPath: input.repoPath,
              runtimeKind: input.runtimeKind,
              workingDirectory: input.workingDirectory,
              externalSessionId: input.externalSessionId,
            },
            acceptedMessage: acceptedUserMessage(input),
            stage: "live_update",
          },
        );
      };
      const actions = createSessionActions({
        adapter,
        sessionsRef,
      });
      await expect(
        actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "Hello" }]),
      ).resolves.toBeUndefined();
      const current = getSession(sessionsRef);
      expect(sends).toBe(1);
      expect(current).toMatchObject({
        status: "running",
        executionEpisodeId: "new",
        pendingQuestions: [{ requestId: "question-1", questions: [] }],
      });
      const messages = sessionMessagesToArray(current);
      expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
      expect(messages.some((message) => message.content.includes("runtime accepted"))).toBe(true);
      expect(messages.some((message) => message.content.includes("Failed to send"))).toBe(false);
    },
  );
});

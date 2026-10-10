import { describe, expect, test } from "bun:test";
import { AgentRuntimeTestAdapter } from "../../../../test-support/agent-runtime-test-adapter";
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
import { createOpenCodeAgentEngineTestAdapter } from "./opencode-agent-engine.test-support";
import { acceptedUserMessage } from "./session-actions-send.test-support";

describe("agent-orchestrator/handlers/session-actions send acceptance", () => {
  test.each(["event-first", "response-first"] as const)(
    "keeps confirmed delivery after a queued send response in %s order",
    async (order) => {
      const adapter = new AgentRuntimeTestAdapter();
      const handlers: Parameters<typeof adapter.subscribeEvents>[1][] = [];
      adapter.subscribeEvents = async (_ref, handler) => {
        handlers.push(handler);
        return () => {};
      };
      const delivered = {
        ...acceptedUserMessage({
          externalSessionId: "session-1",
          parts: [{ kind: "text", text: "Hello" }],
        }),
        timestamp: "2026-02-22T08:00:02.000Z",
      };
      const queued = {
        ...delivered,
        timestamp: "2026-02-22T08:00:01.000Z",
        state: "queued" as const,
      };
      const sessionsRef = createSessionsRef([
        buildSession({ status: "running", historyLoadState: "loaded", executionEpisodeId: "busy" }),
      ]);
      adapter.sendUserMessage = async () => {
        if (order === "event-first") for (const handler of handlers) handler(delivered);
        return queued;
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
        if (order === "response-first") {
          expect(sessionMessagesToArray(getSession(sessionsRef))[0]?.meta).toMatchObject({
            kind: "user",
            state: "queued",
          });
          for (const handler of handlers) handler(delivered);
        }
        for (const handler of handlers)
          handler({ ...queued, messageId: "next-user", message: "Next" });
        const current = getSession(sessionsRef);
        expect(
          sessionMessagesToArray(current).filter((message) => message.role === "user"),
        ).toMatchObject([
          {
            id: delivered.messageId,
            content: "Hello",
            timestamp: delivered.timestamp,
            meta: { kind: "user", state: "read" },
          },
          { id: "next-user", meta: { kind: "user", state: "queued" } },
        ]);
        expect(current).toMatchObject({ status: "running", executionEpisodeId: "busy" });
      } finally {
        unsubscribe();
      }
    },
  );

  test.each(["event-first", "response-first"] as const)(
    "does not duplicate accepted queued input in %s order",
    async (order) => {
      const adapter = new AgentRuntimeTestAdapter();
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
      const adapter = createOpenCodeAgentEngineTestAdapter(new AgentRuntimeTestAdapter());
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
      const receipt = await actions.sendAgentMessage(getSession(sessionsRef), [
        { kind: "text", text: "Hello" },
      ]);
      expect(receipt).toMatchObject({
        recipient: {
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
          externalSessionId: "session-1",
        },
        acceptedMessage: { messageId: "accepted-user-message", message: "Hello" },
        postAcceptanceFailure: "The runtime accepted the message, but the session update failed.",
      });
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
  test.each(["accepted", "publication-failed"] as const)(
    "does not invent a user message for a command that is %s",
    async (result) => {
      const adapter = new AgentRuntimeTestAdapter();
      const sessionsRef = createSessionsRef([
        buildSession({ status: "running", historyLoadState: "loaded", executionEpisodeId: "busy" }),
      ]);
      let sends = 0;
      adapter.sendUserMessage = async (input) => {
        sends++;
        const accepted = { type: "command_accepted" as const, commandName: "inspect" };
        if (result === "accepted") return accepted;
        throw new HostInvokeError("OpenCode accepted the command. Do not send it again.", {
          kind: "agent_session_command_accepted",
          sessionRef: {
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
          },
          acceptedCommand: accepted,
        });
      };
      const actions = createSessionActions({ adapter, sessionsRef });
      await actions.sendAgentMessage(getSession(sessionsRef), [
        { kind: "text", text: "Command input" },
      ]);
      expect(sends).toBe(1);
      expect(
        sessionMessagesToArray(getSession(sessionsRef)).filter(
          (message) => message.role === "user",
        ),
      ).toEqual([]);
      expect(getSession(sessionsRef)).toMatchObject({
        status: "running",
        executionEpisodeId: "busy",
      });
      if (result === "publication-failed")
        expect(
          sessionMessagesToArray(getSession(sessionsRef)).some((message) =>
            message.content.includes("Do not send it again"),
          ),
        ).toBe(true);
    },
  );
});

import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import type { AgentEnginePort, AgentUserMessagePart } from "@openducktor/core";
import { createOpenCodeAgentEngineTestAdapter } from "./opencode-agent-engine.test-support";
import { acceptedUserMessage } from "./session-actions-send.test-support";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
} from "./session-actions.test-helpers";

const repositorySendCases: Array<{ label: string; parts: AgentUserMessagePart[] }> = [
  {
    label: "text",
    parts: [{ kind: "text", text: "hello repository" }],
  },
  {
    label: "manual compaction",
    parts: [
      {
        kind: "slash_command",
        command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
      },
    ],
  },
];

describe("agent-orchestrator/handlers/session-actions send scope", () => {
  test.each(repositorySendCases)(
    "routes repository $label without workflow side effects",
    async ({ parts }) => {
      const adapter = createOpenCodeAgentEngineTestAdapter(new OpencodeSdkAdapter());
      const sendInputs: Parameters<typeof adapter.sendUserMessage>[0][] = [];
      adapter.sendUserMessage = async (input) => {
        sendInputs.push(input);
        return acceptedUserMessage(input);
      };
      const sessionsRef = createSessionsRef([
        buildSession({
          status: "idle",
          sessionAssociation: { kind: "repository" },
          repoPath: "/tmp/session-repository",
          workingDirectory: "/tmp/repo/repository-chat",
        }),
      ]);
      const actions = createSessionActions({
        adapter,
        sessionsRef,
        workspaceRepoPath: "/tmp/active-workspace",
        currentWorkspaceRepoPathRef: { current: "/tmp/active-workspace" },
        taskRef: { current: [] },
        ensureExistingSessionRuntime: async () => {
          throw new Error("repository sends must not ensure a workflow runtime");
        },
        loadRepoPromptOverrides: async () => {
          throw new Error("repository sends must not load workflow prompts");
        },
        persistSessionRecord: async () => {
          throw new Error("repository sends must not persist task sessions");
        },
        refreshTaskData: async () => {
          throw new Error("repository sends must not refresh task data");
        },
        invalidateSessionStopQueries: async () => {
          throw new Error("repository sends must not invalidate task queries");
        },
      });

      await actions.sendAgentMessage(getSession(sessionsRef), parts);

      expect(sendInputs).toHaveLength(1);
      expect(sendInputs[0]).toMatchObject({
        repoPath: "/tmp/session-repository",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/repository-chat",
        externalSessionId: "session-1",
        sessionScope: { kind: "repository" },
      });
      expect(sendInputs[0]).not.toHaveProperty("systemPrompt");
    },
  );

  test("rejects sends to stopped sessions before runtime or workflow work", async () => {
    const adapter = new OpencodeSdkAdapter();
    let sendCalls = 0;
    adapter.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessage(input);
    };
    const sessionsRef = createSessionsRef([buildSession({ status: "stopped" })]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {
        throw new Error("stopped sends must not prepare a runtime");
      },
    });

    await expect(
      actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]),
    ).rejects.toThrow("Cannot send message to stopped session 'session-1'.");
    expect(sendCalls).toBe(0);
  });

  test("rejects unbound sends with a clear context error", async () => {
    const adapter = new OpencodeSdkAdapter();
    let sendCalls = 0;
    adapter.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessage(input);
    };
    const sessionsRef = createSessionsRef([
      buildSession({ status: "idle", sessionAssociation: { kind: "unbound" } }),
    ]);
    const actions = createSessionActions({ adapter, sessionsRef });

    await expect(
      actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]),
    ).rejects.toThrow(
      "Cannot send message for unbound session 'session-1'; repository or workflow context is required.",
    );
    expect(sendCalls).toBe(0);
  });

  test("rejects a missing association before calling the runtime", async () => {
    const adapter = new OpencodeSdkAdapter();
    let sendCalls = 0;
    adapter.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessage(input);
    };
    const malformedSession = buildSession({ status: "idle" });
    Reflect.deleteProperty(malformedSession, "sessionAssociation");
    const sessionsRef = createSessionsRef([malformedSession]);
    const actions = createSessionActions({ adapter, sessionsRef });

    await expect(
      actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]),
    ).rejects.toThrow(
      "Cannot send message for session 'session-1' because its association is missing.",
    );
    expect(sendCalls).toBe(0);
  });

  test.each(["opencode", "codex", "claude"] as const)(
    "uses the same repository send handler for %s",
    async (runtimeKind) => {
      const baseAdapter = createOpenCodeAgentEngineTestAdapter(new OpencodeSdkAdapter());
      const sendInputs: Parameters<AgentEnginePort["sendUserMessage"]>[0][] = [];
      const adapter: AgentEnginePort = {
        ...baseAdapter,
        sendUserMessage: async (input) => {
          sendInputs.push(input);
          return acceptedUserMessage(input);
        },
      };
      const sessionsRef = createSessionsRef([
        buildSession({
          runtimeKind,
          sessionAssociation: { kind: "repository" },
          status: "idle",
        }),
      ]);
      const actions = createSessionActions({ adapter, sessionsRef, taskRef: { current: [] } });

      await actions.sendAgentMessage(getSession(sessionsRef), [
        { kind: "text", text: "runtime-neutral send" },
      ]);

      expect(sendInputs).toHaveLength(1);
      expect(sendInputs[0]).toMatchObject({
        runtimeKind,
        sessionScope: { kind: "repository" },
      });
    },
  );
});

import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  buildSession,
  createSessionsRef,
  createSessionTurnMetadata,
  createSessionUpdater,
  findSession,
  getSession,
  getSessionMessages,
  handleAssistantPart,
  type SessionPartEventContext,
} from "./session-events-test-harness";

const createPartContext = (
  session: AgentSessionState,
  sessionsRef: ReturnType<typeof createSessionsRef>,
): SessionPartEventContext => ({
  session: {
    identity: session,
    key: agentSessionIdentityKey(session),
    repoPath: "/tmp/repo",
  },
  store: {
    updateSession: createSessionUpdater(sessionsRef),
    readSession: (identity) => findSession(sessionsRef, identity.externalSessionId) ?? null,
    ensureSession: (_identity, createSession) => createSession(),
    isSessionObserved: (identity) => identity.externalSessionId === session.externalSessionId,
  },
  turn: {
    turnMetadata: createSessionTurnMetadata(),
    recordTurnActivityTimestamp: () => {},
    recordTurnUserMessageTimestamp: () => {},
    resolveTurnDurationMs: () => undefined,
    clearTurnDuration: () => {},
  },
  refresh: {
    refreshTaskData: async () => {},
    workflowToolAliasesByCanonical: undefined,
  },
  todos: {
    updateSessionTodos: () => {},
  },
});

const runtimeCases = [
  {
    runtimeKind: "opencode" as const,
    selectedModel: {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-sonnet",
    },
  },
  {
    runtimeKind: "codex" as const,
    selectedModel: {
      runtimeKind: "codex" as const,
      providerId: "openai",
      modelId: "gpt-5.6-luna",
      variant: "high",
    },
  },
] as const;

describe("assistant part runtime isolation", () => {
  for (const runtimeCase of runtimeCases) {
    test(`keeps completed ${runtimeCase.runtimeKind} text parts as drafts`, () => {
      const sessionsRef = createSessionsRef([
        buildSession({
          runtimeKind: runtimeCase.runtimeKind,
          selectedModel: runtimeCase.selectedModel,
        }),
      ]);
      const session = getSession(sessionsRef);

      handleAssistantPart(createPartContext(session, sessionsRef), {
        type: "assistant_part",
        externalSessionId: session.externalSessionId,
        timestamp: "2026-07-10T21:24:06.000Z",
        part: {
          kind: "text",
          messageId: "assistant-draft-1",
          partId: "assistant-draft-1:text",
          text: "I am inspecting the repository before continuing.",
          completed: true,
        },
      });

      expect(getSessionMessages(sessionsRef)[0]).toMatchObject({
        role: "assistant",
        meta: {
          kind: "assistant",
          isFinal: false,
        },
      });
    });
  }
});

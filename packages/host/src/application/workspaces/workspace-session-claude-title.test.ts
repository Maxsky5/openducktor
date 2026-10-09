import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { initialSpeedState } from "@openducktor/core";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClaudeLiveSessionState } from "../../adapters/agent-sessions/claude-live-session-state";
import { toClaudeSendInput } from "../../adapters/agent-sessions/claude-live-session-service-inputs";
import { handleClaudeSdkMessage } from "../../adapters/claude/claude-agent-sdk-events";
import { sendClaudeUserMessage } from "../../adapters/claude/claude-agent-sdk-session-io";
import { createClaudeSession } from "../../adapters/claude/claude-agent-sdk-session-io.test-support";
import { createClaudeAgentSdkSessionStore } from "../../adapters/claude/claude-agent-sdk-session-store";
import { fromPromise } from "../../adapters/claude/claude-agent-sdk-utils";
import { updateClaudeSessionTitle } from "../../adapters/claude/claude-session-title-update";
import { claudeSdkMessageFixture } from "../../adapters/claude/claude-agent-sdk-test-messages";
import type { ClaudeSession } from "../../adapters/claude/claude-agent-sdk-types";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import {
  createPersistenceHarness,
  waitFor,
} from "./test-support/workspace-session-runtime-persistence-harness";

test("accepts the first Claude workspace message before its native transcript exists", async () => {
  const database = await createSqliteTaskStoreHarness();
  const sessionStore = createClaudeAgentSdkSessionStore();
  const h = await createPersistenceHarness(database, "claude", false, (ref) => {
    const session = createSession(ref);
    sessionStore.set(session);
    return {
      sendUserMessage: (messageInput) =>
        fromPromise("test.claude.send", () =>
          sendClaudeUserMessage({
            messageInput: toClaudeSendInput(messageInput),
            session,
            emit: () => {},
            now: () => "2026-09-07T10:00:00Z",
            randomId: () => "e3796c35-514e-4919-a077-68f58d5b47dd",
          }),
        ),
      updateSessionTitle: (input) => updateClaudeSessionTitle(input, { sessionStore }),
    };
  });
  try {
    const accepted = await h.send("Hi");
    expect(accepted).toMatchObject({ message: "Hi", state: "read" });
    expect((await h.get()).generatedTitle).toBe("Hi");
    expect(h.persistence.isTitleSyncPending(h.ref)).toBe(true);
  } finally {
    await Effect.runPromise(h.persistence.shutdown());
    await Effect.runPromise(sessionStore.stopSessionsForRuntime("claude-runtime-1"));
    await database.cleanup();
  }
});

test("waits for a completed Claude turn and syncs the latest title once", async () => {
  const database = await createSqliteTaskStoreHarness();
  const h = await createPersistenceHarness(database, "claude");
  const session = createSession(h.ref);
  try {
    await h.send("Hi");
    session.activity = "running";
    await publishSdkMessage(
      h,
      session,
      claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        session_id: h.ref.externalSessionId,
      }),
    );
    expect(h.titleAttempts).toEqual([]);
    await Effect.runPromise(
      h.workspaceService().rename({
        workspaceId: h.storeRef.workspaceId,
        sessionId: h.storeRef.sessionId,
        manualTitle: "Manual title",
      }),
    );
    expect(h.titleAttempts).toEqual([]);

    session.activity = "running";
    session.activeSdkUserTurnCount = 1;
    session.pendingUserTurnCount = 1;
    await publishSdkMessage(h, session, completedResult(h.ref.externalSessionId));
    await waitFor(() => !h.persistence.isTitleSyncPending(h.ref));
    expect(h.titleAttempts).toEqual(["Manual title"]);
    expect(h.state.nativeTitle).toBe("Manual title");
    expect((await h.get()).manualTitle).toBe("Manual title");
    expect(h.renameFailures).toEqual([]);

    await publishSdkMessage(h, session, completedResult(h.ref.externalSessionId));
    expect(h.titleAttempts).toEqual(["Manual title"]);
  } finally {
    await Effect.runPromise(h.persistence.shutdown());
    await database.cleanup();
  }
});

test("reports a Claude title failure once and keeps the saved title", async () => {
  const database = await createSqliteTaskStoreHarness();
  const h = await createPersistenceHarness(database, "claude");
  const session = createSession(h.ref);
  try {
    h.state.failTitle = true;
    await h.send("Hi");
    expect((await h.get()).generatedTitle).toBe("First accepted prompt");
    await publishSdkMessage(h, session, completedResult(h.ref.externalSessionId));
    await waitFor(() => h.renameFailures.length === 1);
    expect(h.renameFailures[0]).toContain("Could not sync this Workspace Session title to Claude.");
    expect(h.renameFailures[0]).toContain("runtime title update failed");
    expect((await h.get()).generatedTitle).toBe("First accepted prompt");
    await publishSdkMessage(h, session, completedResult(h.ref.externalSessionId));
    expect(h.titleAttempts).toEqual(["First accepted prompt"]);
  } finally {
    await Effect.runPromise(h.persistence.shutdown());
    await database.cleanup();
  }
});

function createSession(ref: AgentSessionLiveRef): ClaudeSession {
  return createClaudeSession({
    externalSessionId: ref.externalSessionId,
    input: {
      ...ref,
      runtimeKind: "claude",
      runtimePolicy: { kind: "claude" },
      sessionScope: { kind: "repository" },
    },
    summary: {
      speed: initialSpeedState("standard", "confirmed"),
      externalSessionId: ref.externalSessionId,
      runtimeKind: "claude",
      workingDirectory: ref.workingDirectory,
      startedAt: "2026-09-07T10:00:00Z",
      sessionAssociation: { kind: "repository" },
      status: "idle",
    },
  });
}

async function publishSdkMessage(
  h: Awaited<ReturnType<typeof createPersistenceHarness>>,
  session: ClaudeSession,
  message: SDKMessage,
): Promise<void> {
  const projection = createClaudeLiveSessionState(() => session.model);
  const events: Parameters<typeof h.emit>[0][] = [];
  handleClaudeSdkMessage({
    session,
    message,
    timestamp: "2026-09-07T10:01:00Z",
    modelSelection: (modelId) => ({ providerId: "claude", modelId, runtimeKind: "claude" }),
    emit: (event) => {
      for (const change of projection.applyEvent(session, event)) {
        if (change.type === "transcript_event") events.push(change.event);
      }
    },
  });
  for (const event of events) await h.emit(event);
}

function completedResult(sessionId: string): SDKMessage {
  return claudeSdkMessageFixture({
    type: "result",
    subtype: "success",
    session_id: sessionId,
    is_error: false,
    stop_reason: "end_turn",
    terminal_reason: "completed",
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

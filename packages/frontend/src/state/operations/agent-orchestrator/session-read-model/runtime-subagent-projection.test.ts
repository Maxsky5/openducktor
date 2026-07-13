import { describe, expect, test } from "bun:test";
import { toAgentSessionRuntimeSnapshot } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { applyLoadedSessionHistory } from "@/state/operations/agent-orchestrator/support/session-history-chat-messages";
import { createSubagentMessage } from "@/state/operations/agent-orchestrator/support/subagent-messages";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { runtimeChildSnapshotsForSession } from "./runtime-child-snapshots";
import { projectRuntimeSubagentsToSession } from "./runtime-subagent-projection";

const createRuntimeSnapshot = ({
  externalSessionId,
  parentExternalSessionId,
  runtimeActivity = "idle",
  startedAt = "2026-07-10T12:00:00.000Z",
}: {
  externalSessionId: string;
  parentExternalSessionId: string;
  runtimeActivity?: "running" | "idle";
  startedAt?: string;
}) =>
  toAgentSessionRuntimeSnapshot({
    ref: {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo/worktree",
      externalSessionId,
    },
    snapshot: {
      parentExternalSessionId,
      title: "Codex child",
      startedAt,
      runtimeActivity,
      pendingApprovals: [],
      pendingQuestions: [],
    },
  });

const parentSession = () =>
  createAgentSessionFixture({
    externalSessionId: "parent-session",
    runtimeKind: "codex",
    workingDirectory: "/repo/worktree",
    messages: [],
  });

describe("projectRuntimeSubagentsToSession", () => {
  test("projects an unmaterialized runtime child with its lifecycle status", () => {
    const session = parentSession();
    const child = createRuntimeSnapshot({
      externalSessionId: "child-session",
      parentExternalSessionId: session.externalSessionId,
      runtimeActivity: "running",
    });

    const projection = projectRuntimeSubagentsToSession({
      session,
      runtimeChildSnapshots: runtimeChildSnapshotsForSession({
        session,
        runtimeSnapshots: new Map([[agentSessionIdentityKey(child.ref), child]]),
        materializedSessionKeys: new Set([agentSessionIdentityKey(session)]),
      }),
    });

    expect(projection.hasActiveChild).toBe(true);
    expect(sessionMessagesToArray(projection.session)).toEqual([
      expect.objectContaining({
        meta: expect.objectContaining({
          kind: "subagent",
          externalSessionId: "child-session",
          status: "running",
        }),
      }),
    ]);
  });

  test("updates an existing child card instead of projecting a duplicate", () => {
    const existing = createSubagentMessage({
      timestamp: "2026-07-10T12:00:00.000Z",
      meta: {
        kind: "subagent",
        partId: "spawn-1",
        correlationKey: "codex-subagent:parent-session:spawn-1",
        externalSessionId: "child-session",
        prompt: "Inspect child",
        status: "pending",
      },
    });
    const session = createAgentSessionFixture({
      externalSessionId: "parent-session",
      runtimeKind: "codex",
      workingDirectory: "/repo/worktree",
      messages: [existing],
    });
    const child = createRuntimeSnapshot({
      externalSessionId: "child-session",
      parentExternalSessionId: session.externalSessionId,
      runtimeActivity: "running",
    });

    const projection = projectRuntimeSubagentsToSession({
      session,
      runtimeChildSnapshots: runtimeChildSnapshotsForSession({
        session,
        runtimeSnapshots: new Map([[agentSessionIdentityKey(child.ref), child]]),
        materializedSessionKeys: new Set([agentSessionIdentityKey(session)]),
      }),
    });
    const messages = sessionMessagesToArray(projection.session);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: existing.id,
      meta: {
        kind: "subagent",
        externalSessionId: "child-session",
        status: "running",
      },
    });
  });

  test("rejects a runtime snapshot that identifies the parent as its own child", () => {
    const session = parentSession();
    const selfReference = createRuntimeSnapshot({
      externalSessionId: session.externalSessionId,
      parentExternalSessionId: session.externalSessionId,
    });

    const projection = projectRuntimeSubagentsToSession({
      session,
      runtimeChildSnapshots: runtimeChildSnapshotsForSession({
        session,
        runtimeSnapshots: new Map([[agentSessionIdentityKey(selfReference.ref), selfReference]]),
        materializedSessionKeys: new Set(),
      }),
    });

    expect(projection.session).toBe(session);
    expect(projection.hasActiveChild).toBe(false);
  });

  test("keeps legacy and current Codex children at their original parent transcript positions", () => {
    const session = parentSession();
    const inventoryOnlyChild = createRuntimeSnapshot({
      externalSessionId: "inventory-only-child",
      parentExternalSessionId: session.externalSessionId,
    });
    const historyLinkedChild = createRuntimeSnapshot({
      externalSessionId: "history-linked-child",
      parentExternalSessionId: session.externalSessionId,
      startedAt: "2026-07-10T12:02:00.000Z",
    });
    const projection = projectRuntimeSubagentsToSession({
      session,
      runtimeChildSnapshots: runtimeChildSnapshotsForSession({
        session,
        runtimeSnapshots: new Map([
          [agentSessionIdentityKey(inventoryOnlyChild.ref), inventoryOnlyChild],
          [agentSessionIdentityKey(historyLinkedChild.ref), historyLinkedChild],
        ]),
        materializedSessionKeys: new Set([agentSessionIdentityKey(session)]),
      }),
    });

    const hydrated = applyLoadedSessionHistory(projection.session, [
      {
        messageId: "parent-user",
        role: "user",
        timestamp: "2026-07-10T11:59:00.000Z",
        text: "Delegate this work",
        displayParts: [{ kind: "text", text: "Delegate this work" }],
        state: "read",
        parts: [],
      },
      {
        messageId: "parent-delegating",
        role: "assistant",
        timestamp: "2026-07-10T11:59:30.000Z",
        text: "I am delegating this now.",
        parts: [],
      },
      {
        messageId: "parent-new-protocol-spawn",
        role: "assistant",
        timestamp: "2026-07-10T12:02:00.000Z",
        text: "",
        parts: [
          {
            kind: "subagent",
            messageId: "parent-new-protocol-spawn",
            partId: "spawn-history-linked-child",
            correlationKey: "codex-subagent:parent-session:history-linked-child",
            status: "running",
            prompt: "Codex child",
            externalSessionId: "history-linked-child",
          },
        ],
      },
      {
        messageId: "parent-final",
        role: "assistant",
        timestamp: "2026-07-10T12:04:00.000Z",
        text: "The subagent completed the work.",
        parts: [],
      },
    ]);

    expect(sessionMessagesToArray(hydrated).map((message) => message.id)).toEqual([
      "parent-user",
      "parent-delegating",
      "subagent:session:inventory-only-child",
      "subagent:codex-subagent:parent-session:history-linked-child",
      "parent-final",
    ]);
    expect(
      sessionMessagesToArray(hydrated)
        .filter((message) => message.meta?.kind === "subagent")
        .map((message) => message.meta?.kind === "subagent" && message.meta.status),
    ).toEqual(["completed", "completed"]);
  });
});

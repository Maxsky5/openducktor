import { describe, expect, test } from "bun:test";
import { toAgentSessionRuntimeSnapshot } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { runtimeChildSnapshotsForSession } from "./runtime-child-snapshots";
import { projectRuntimeSubagentsToSession } from "./runtime-subagent-projection";

const createRuntimeSnapshot = ({
  externalSessionId,
  parentExternalSessionId,
  runtimeActivity = "idle",
}: {
  externalSessionId: string;
  parentExternalSessionId: string;
  runtimeActivity?: "running" | "idle";
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
      startedAt: "2026-07-10T12:00:00.000Z",
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
});

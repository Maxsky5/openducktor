import type { TaskCard } from "@openducktor/contracts";
import type {
  AgentSessionPresenceSnapshot,
  AgentSessionRef,
  LiveAgentSessionSnapshot,
} from "@openducktor/core";
import { toAgentSessionPresenceSnapshotFromLiveSnapshot } from "@openducktor/core";
import {
  createDeferred as createSharedDeferred,
  createTaskCardFixture as createSharedTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";

const ORCHESTRATOR_TASK_CARD_DEFAULTS: Partial<TaskCard> = {
  title: "Task",
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
};

export const createDeferred = createSharedDeferred;

export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | "timeout"> => {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    }),
  ]);
};

export const createTaskCardFixture = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createSharedTaskCardFixture(ORCHESTRATOR_TASK_CARD_DEFAULTS, overrides);

const createLiveAgentSessionSnapshotFixture = (
  overrides: Partial<LiveAgentSessionSnapshot> = {},
): LiveAgentSessionSnapshot => {
  const externalSessionId = overrides.externalSessionId ?? "external-1";

  return {
    externalSessionId,
    title: overrides.title ?? "BUILD task-1",
    workingDirectory: "/tmp/repo/worktree",
    startedAt: "2026-02-22T08:00:00.000Z",
    status: { type: "idle" },
    pendingApprovals: [],
    pendingQuestions: [],
    ...overrides,
  };
};

export const createAgentSessionPresenceSnapshotFixture = ({
  ref: refOverrides = {},
  snapshot: snapshotOverrides = {},
}: {
  ref?: Partial<AgentSessionRef>;
  snapshot?: Partial<LiveAgentSessionSnapshot>;
} = {}): AgentSessionPresenceSnapshot => {
  const ref: AgentSessionRef = {
    repoPath: "/tmp/repo",
    runtimeKind: "opencode",
    workingDirectory: "/tmp/repo/worktree",
    externalSessionId: "external-1",
    ...refOverrides,
  };

  return toAgentSessionPresenceSnapshotFromLiveSnapshot({
    ref,
    snapshot: createLiveAgentSessionSnapshotFixture({
      ...snapshotOverrides,
      externalSessionId: ref.externalSessionId,
      workingDirectory: ref.workingDirectory,
    }),
  });
};

import type { TaskCard } from "@openducktor/contracts";
import type { LiveAgentSessionSnapshot } from "@openducktor/core";
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

export const createLiveAgentSessionSnapshotFixture = (
  overrides: Partial<LiveAgentSessionSnapshot> = {},
): LiveAgentSessionSnapshot => {
  const externalSessionId = overrides.externalSessionId ?? "external-1";

  return {
    externalSessionId,
    title: overrides.title ?? `Session ${externalSessionId}`,
    workingDirectory: "/tmp/repo/worktree",
    startedAt: "2026-02-22T08:00:00.000Z",
    status: { type: "busy" },
    pendingPermissions: [],
    pendingQuestions: [],
    ...overrides,
  };
};

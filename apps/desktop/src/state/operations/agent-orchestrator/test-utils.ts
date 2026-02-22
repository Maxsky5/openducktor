import type { TaskCard } from "@openducktor/contracts";
import {
  createAgentSessionFixture as createSharedAgentSessionFixture,
  createDeferred as createSharedDeferred,
  createTaskCardFixture as createSharedTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";

const ORCHESTRATOR_TASK_CARD_DEFAULTS: Partial<TaskCard> = {
  title: "Task",
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
};

const ORCHESTRATOR_SESSION_DEFAULTS: Partial<AgentSessionState> = {
  startedAt: "2026-02-22T08:00:00.000Z",
  baseUrl: "http://127.0.0.1:4444",
  workingDirectory: "/tmp/repo/worktree",
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

export const createAgentSessionFixture = (
  overrides: Partial<AgentSessionState> = {},
): AgentSessionState => createSharedAgentSessionFixture(ORCHESTRATOR_SESSION_DEFAULTS, overrides);

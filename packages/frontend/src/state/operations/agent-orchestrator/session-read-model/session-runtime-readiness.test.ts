import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import { deriveSessionRuntimeReadiness } from "./session-runtime-readiness";
import type { TaskSessionRecords } from "./task-session-records";

const record: AgentSessionRecord = {
  externalSessionId: "session-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-06-19T07:00:00.000Z",
  selectedModel: null,
};

const taskSessionRecords: TaskSessionRecords = {
  taskIds: ["task-1"],
  records: [{ taskId: "task-1", record }],
};

describe("session runtime readiness", () => {
  test("treats automatic not-started runtime health as waiting", () => {
    const readiness = deriveSessionRuntimeReadiness({
      tasks: taskSessionRecords,
      runtimeHealthByRuntime: {
        opencode: createRepoRuntimeHealthFixture({
          status: "not_started",
          runtime: {
            status: "not_started",
            stage: "idle",
            detail: "Runtime has not been started yet.",
          },
        }),
      },
    });

    expect(readiness).toEqual({ kind: "waiting_for_runtime" });
  });
});

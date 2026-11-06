import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { describe, expect, test } from "bun:test";
import { mobileSessionForkDisabledReason } from "./session-fork-model";

const interaction = {
  canInteract: true,
  blockedReason: null,
  runtimeReadiness: {
    state: "ready" as const,
    message: null,
    isLoadingChecks: false,
    refreshChecks: async () => {},
  },
};
const owner = { kind: "task" as const, taskId: "TASK-1", role: "build" as const };
const directMerge = {
  method: "merge_commit" as const,
  sourceBranch: "odt/task-1",
  targetBranch: { branch: "main", remote: "origin" },
  mergedAt: "2026-11-06T10:00:00.000Z",
};

describe("mobileSessionForkDisabledReason", () => {
  test("a task session forks while its task has no waiting merge", () => {
    const task = createTaskCardFixture({ id: "TASK-1", status: "human_review" });
    expect(mobileSessionForkDisabledReason({ owner, task, interaction })).toBeNull();
  });

  test("blocks a fork while a local direct merge of the task waits for its publication", () => {
    const task = createTaskCardFixture({ id: "TASK-1", status: "human_review", directMerge });
    expect(mobileSessionForkDisabledReason({ owner, task, interaction })).toBe(
      "Publish or close the local merge before you fork a reply.",
    );
  });
});

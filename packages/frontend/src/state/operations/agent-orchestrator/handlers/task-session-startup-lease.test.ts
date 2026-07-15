import { describe, expect, test } from "bun:test";
import { acquireTaskSessionStartupLease } from "./task-session-startup-lease";

describe("acquireTaskSessionStartupLease", () => {
  test("binds completion and abort to the acquired lease identity", async () => {
    const calls: unknown[] = [];
    const lease = await acquireTaskSessionStartupLease({
      repoPath: "/repo",
      taskId: "task-1",
      role: "planner",
      prepare: async (...args) => {
        calls.push(["prepare", ...args]);
        return "lease-1";
      },
      complete: async (...args) => {
        calls.push(["complete", ...args]);
      },
      abort: async (...args) => {
        calls.push(["abort", ...args]);
      },
    });

    await lease.bootstrap.complete();

    const abortedLease = await acquireTaskSessionStartupLease({
      repoPath: "/repo",
      taskId: "task-1",
      role: "planner",
      prepare: async () => "lease-2",
      complete: async () => {},
      abort: async (...args) => {
        calls.push(["abort", ...args]);
      },
    });
    await abortedLease.bootstrap.abort();

    expect(calls).toEqual([
      ["prepare", "/repo", "task-1", "planner"],
      ["complete", "/repo", "task-1", "lease-1"],
      ["abort", "/repo", "task-1", "lease-2"],
    ]);
  });
});

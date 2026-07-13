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

  test("preserves the startup error when aborting the lease also fails", async () => {
    const startupError = new Error("fork failed");
    const lease = await acquireTaskSessionStartupLease({
      repoPath: "/repo",
      taskId: "task-1",
      role: "build",
      prepare: async () => "lease-1",
      complete: async () => {},
      abort: async () => {
        throw new Error("host unavailable");
      },
    });

    const error = await lease.abortAfter(startupError).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "fork failed Failed to release the task session startup lease: host unavailable",
    );
    expect((error as Error).cause).toBe(startupError);
  });

  test("rethrows the original startup error after a successful abort", async () => {
    const startupError = { reason: "fork failed" };
    const lease = await acquireTaskSessionStartupLease({
      repoPath: "/repo",
      taskId: "task-1",
      role: "qa",
      prepare: async () => "lease-1",
      complete: async () => {},
      abort: async () => {},
    });

    const error = await lease.abortAfter(startupError).catch((cause: unknown) => cause);
    expect(error).toBe(startupError);
  });
});

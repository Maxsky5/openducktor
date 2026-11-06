import { describe, expect, test } from "bun:test";
import { skipToken } from "@tanstack/react-query";
import {
  classifyDiagnosticsQueryError,
  DiagnosticsQueryTimeoutError,
  taskStoreCheckQueryOptionsOrSkip,
  withDiagnosticsQueryTimeout,
} from "./checks";

/** A scheduler that runs its task only when the test calls `fire`. */
const manualScheduler = () => {
  let task: (() => void) | null = null;
  let canceled = false;
  return {
    schedule: (next: () => void) => {
      task = next;
      return () => {
        canceled = true;
      };
    },
    fire: () => task?.(),
    canceled: () => canceled,
  };
};

describe("withDiagnosticsQueryTimeout", () => {
  test("aborts the request signal and fails with a timeout error after the deadline", async () => {
    const scheduler = manualScheduler();
    let requestSignal: AbortSignal | undefined;
    const read = withDiagnosticsQueryTimeout(
      (signal) => {
        requestSignal = signal;
        return new Promise<never>(() => {});
      },
      scheduler.schedule,
      new AbortController().signal,
      5_000,
    ).catch((cause: unknown) => cause);

    scheduler.fire();

    const failure = await read;
    expect(failure).toBeInstanceOf(DiagnosticsQueryTimeoutError);
    expect(requestSignal?.aborted).toBe(true);
    expect(requestSignal?.reason).toBe(failure);
    expect(scheduler.canceled()).toBe(true);
  });

  test("aborts the request signal when the query is canceled", async () => {
    const scheduler = manualScheduler();
    const query = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const read = withDiagnosticsQueryTimeout(
      (signal) => {
        requestSignal = signal;
        return new Promise<never>(() => {});
      },
      scheduler.schedule,
      query.signal,
    ).catch((cause: unknown) => cause);
    const reason = new Error("The view closed.");

    query.abort(reason);

    expect(await read).toBe(reason);
    expect(requestSignal?.aborted).toBe(true);
    expect(scheduler.canceled()).toBe(true);
  });

  test("returns the result and stops the deadline", async () => {
    const scheduler = manualScheduler();
    let requestSignal: AbortSignal | undefined;

    const result = await withDiagnosticsQueryTimeout(
      async (signal) => {
        requestSignal = signal;
        return "ready";
      },
      scheduler.schedule,
      new AbortController().signal,
    );

    expect(result).toBe("ready");
    expect(requestSignal?.aborted).toBe(false);
    expect(scheduler.canceled()).toBe(true);
  });
});

describe("classifyDiagnosticsQueryError", () => {
  test("keeps query timeout errors explicit", () => {
    expect(classifyDiagnosticsQueryError(new DiagnosticsQueryTimeoutError(15_000))).toEqual({
      message: "Timed out after 15000ms",
      failureKind: "timeout",
    });
  });

  test("treats generic thrown errors as hard failures", () => {
    expect(classifyDiagnosticsQueryError(new Error("Timed out after 15000ms"))).toEqual({
      message: "Timed out after 15000ms",
      failureKind: "error",
    });
  });
});

describe("taskStoreCheckQueryOptionsOrSkip", () => {
  test("gives a read without a repository the reserved skipped key", () => {
    const skipped = taskStoreCheckQueryOptionsOrSkip(null);
    const live = taskStoreCheckQueryOptionsOrSkip({
      workspaceId: "workspace-1",
      repoPath: "/repo",
    });

    expect(Array.from(skipped.queryKey)).toEqual(["checks", "skipped", "task-store"]);
    expect(skipped.queryFn).toBe(skipToken);
    expect(Array.from(live.queryKey)).toEqual([
      "checks",
      "task-store",
      { workspaceId: "workspace-1", repoPath: "/repo" },
    ]);
    expect(live.queryKey).not.toEqual(
      taskStoreCheckQueryOptionsOrSkip({ workspaceId: "workspace-2", repoPath: "/repo" }).queryKey,
    );
  });
});

import { describe, expect, test } from "bun:test";
import { runOrchestratorSideEffect, runOrchestratorTask } from "./async-side-effects";

describe("agent-orchestrator/support/async-side-effects", () => {
  test("logs side-effect failures as errors by default", async () => {
    const originalError = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      calls.push(args);
    };

    let observedReason = "";
    try {
      await new Promise<void>((resolve) => {
        runOrchestratorSideEffect("side-effect-default", Promise.reject(new Error("boom")), {
          onFailure: (failure) => {
            observedReason = failure.reason;
            resolve();
          },
        });
      });
    } finally {
      console.error = originalError;
    }

    expect(observedReason).toBe("boom");
    expect(calls.length).toBe(1);
    expect(String(calls[0]?.[1] ?? "")).toBe("side-effect-default");
  });

  test("logs async task failures at warn level and rethrows them", async () => {
    const originalError = console.error;
    const originalWarn = console.warn;
    const errorCalls: unknown[][] = [];
    const warnCalls: unknown[][] = [];

    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };

    try {
      await expect(
        runOrchestratorTask(
          "task-warn",
          async () => {
            throw new Error("recoverable");
          },
          {
            logLevel: "warn",
          },
        ),
      ).rejects.toThrow("recoverable");
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
    }

    expect(errorCalls.length).toBe(0);
    expect(warnCalls.length).toBe(1);
    expect(String(warnCalls[0]?.[1] ?? "")).toBe("task-warn");
  });

  test("supports no-log mode while still propagating failures", async () => {
    const originalError = console.error;
    const originalWarn = console.warn;
    const errorCalls: unknown[][] = [];
    const warnCalls: unknown[][] = [];

    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };

    try {
      await expect(
        runOrchestratorTask(
          "task-none",
          async () => {
            throw new Error("hidden");
          },
          {
            logLevel: "none",
          },
        ),
      ).rejects.toThrow("hidden");
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
    }

    expect(errorCalls.length).toBe(0);
    expect(warnCalls.length).toBe(0);
  });

  test("rethrows the original task error when onFailure throws", async () => {
    const originalError = console.error;
    const originalWarn = console.warn;
    const errorCalls: unknown[][] = [];
    const warnCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };

    try {
      await expect(
        runOrchestratorTask(
          "task-callback-throws",
          async () => {
            throw new Error("task boom");
          },
          {
            onFailure: () => {
              throw new Error("callback boom");
            },
          },
        ),
      ).rejects.toThrow("task boom");
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
    }

    expect(errorCalls).toHaveLength(1);
    expect(String(errorCalls[0]?.[1] ?? "")).toBe("task-callback-throws");
    expect(warnCalls).toHaveLength(1);
    expect(String(warnCalls[0]?.[1] ?? "")).toBe("task-callback-throws-onFailure");
  });
});

import { describe, expect, test } from "bun:test";
import { captureOrchestratorFallback, runOrchestratorSideEffect } from "./async-side-effects";

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

  test("uses warn level for expected fallback paths", async () => {
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
      const result = await captureOrchestratorFallback(
        "fallback-warn",
        async () => {
          throw new Error("recoverable");
        },
        {
          logLevel: "warn",
          fallback: () => "fallback-value",
        },
      );

      expect(result).toBe("fallback-value");
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
    }

    expect(errorCalls.length).toBe(0);
    expect(warnCalls.length).toBe(1);
    expect(String(warnCalls[0]?.[1] ?? "")).toBe("fallback-warn");
  });

  test("supports no-log fallback mode", async () => {
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
      const result = await captureOrchestratorFallback(
        "fallback-none",
        async () => {
          throw new Error("hidden");
        },
        {
          logLevel: "none",
          fallback: () => "ok",
        },
      );

      expect(result).toBe("ok");
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
    }

    expect(errorCalls.length).toBe(0);
    expect(warnCalls.length).toBe(0);
  });
});

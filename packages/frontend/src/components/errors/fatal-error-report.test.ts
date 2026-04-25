import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ensurePromiseRejectionEventPolyfill } from "@/test-utils/promise-rejection-event-polyfill";
import { buildFatalErrorReport, logFatalError } from "./fatal-error-report";

ensurePromiseRejectionEventPolyfill();

describe("buildFatalErrorReport", () => {
  describe("Error instances", () => {
    test("extracts name, message, and stack from an Error", () => {
      const error = new TypeError("Cannot read property 'x' of undefined");

      const report = buildFatalErrorReport(error, "boundary");

      expect(report.title).toBe("TypeError");
      expect(report.message).toBe("Cannot read property 'x' of undefined");
      expect(report.stack).toBeDefined();
      expect(report.source).toBe("boundary");
      expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test("falls back to 'Error' title when name is empty", () => {
      const error = new Error("something failed");
      error.name = "";

      const report = buildFatalErrorReport(error, "error");

      expect(report.title).toBe("Error");
    });
  });

  describe("ErrorEvent", () => {
    test("unwraps inner Error from ErrorEvent", () => {
      const inner = new RangeError("out of range");
      const event = new ErrorEvent("error", {
        error: inner,
        message: "Uncaught RangeError: out of range",
      });

      const report = buildFatalErrorReport(event, "error");

      expect(report.title).toBe("RangeError");
      expect(report.message).toBe("out of range");
      expect(report.stack).toBeDefined();
      expect(report.source).toBe("error");
    });

    test("captures source location from ErrorEvent", () => {
      const event = new ErrorEvent("error", {
        error: new Error("boom"),
        filename: "http://localhost:1420/src/main.tsx",
        lineno: 42,
        colno: 7,
      });

      const report = buildFatalErrorReport(event, "error");

      expect(report.location).toBe("http://localhost:1420/src/main.tsx:42:7");
    });

    test("handles ErrorEvent without inner Error", () => {
      const event = new ErrorEvent("error", {
        message: "Script error.",
      });

      const report = buildFatalErrorReport(event, "error");

      expect(report.title).toBe("Uncaught error");
      expect(report.message).toBe("Script error.");
      expect(report.stack).toBeUndefined();
    });
  });

  describe("PromiseRejectionEvent", () => {
    test("unwraps Error reason", () => {
      const reason = new Error("async failure");
      const event = new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.resolve(),
        reason,
      });

      const report = buildFatalErrorReport(event, "unhandledrejection");

      expect(report.title).toBe("Error");
      expect(report.message).toBe("async failure");
      expect(report.source).toBe("unhandledrejection");
    });

    test("handles string reason", () => {
      const event = new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.resolve(),
        reason: "something broke",
      });

      const report = buildFatalErrorReport(event, "unhandledrejection");

      expect(report.title).toBe("Unhandled promise rejection");
      expect(report.message).toBe("something broke");
    });

    test("handles non-string, non-Error reason", () => {
      const event = new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.resolve(),
        reason: { code: 42 },
      });

      const report = buildFatalErrorReport(event, "unhandledrejection");

      expect(report.title).toBe("Unhandled promise rejection");
      expect(report.message).toBe('{"code":42}');
    });
  });

  describe("string values", () => {
    test("uses string directly as message", () => {
      const report = buildFatalErrorReport("network timeout", "error");

      expect(report.title).toBe("Error");
      expect(report.message).toBe("network timeout");
      expect(report.stack).toBeUndefined();
    });
  });

  describe("unknown values", () => {
    test("handles null", () => {
      const report = buildFatalErrorReport(null, "boundary");

      expect(report.title).toBe("Unknown error");
      expect(report.message).toBe("null");
    });

    test("handles undefined", () => {
      const report = buildFatalErrorReport(undefined, "boundary");

      expect(report.title).toBe("Unknown error");
    });

    test("handles objects", () => {
      const report = buildFatalErrorReport({ status: 500 }, "error");

      expect(report.title).toBe("Unknown error");
      expect(report.message).toBe('{"status":500}');
    });

    test("handles circular references gracefully", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      const report = buildFatalErrorReport(circular, "error");

      expect(report.title).toBe("Unknown error");
      expect(report.message).toBe("[object Object]");
    });
  });
});

describe("logFatalError", () => {
  const originalConsoleError = console.error;
  let consoleErrorMock: ReturnType<typeof mock>;

  beforeEach(() => {
    consoleErrorMock = mock(() => {});
    console.error = consoleErrorMock as unknown as typeof console.error;
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("logs structured metadata with raw value", () => {
    const rawError = new TypeError("test");
    const report = buildFatalErrorReport(rawError, "boundary");

    logFatalError(report, rawError);

    expect(consoleErrorMock).toHaveBeenCalledTimes(1);
    const args = consoleErrorMock.mock.calls[0] as unknown[];
    expect(args[0]).toContain("[AppCrashShell]");
    expect(args[0]).toContain("boundary");

    const context = args[args.length - 1] as Record<string, unknown>;
    expect(context.source).toBe("boundary");
    expect(context.rawValue).toBe(rawError);
    expect(context.timestamp).toBeDefined();
    expect(context.componentStack).toBeUndefined();
  });

  test("includes component stack when provided", () => {
    const rawError = new Error("crash");
    const report = buildFatalErrorReport(rawError, "boundary");
    const componentStack = "\n    at BrokenComponent\n    at App";

    logFatalError(report, rawError, componentStack);

    const args = consoleErrorMock.mock.calls[0] as unknown[];
    const context = args[args.length - 1] as Record<string, unknown>;
    expect(context.componentStack).toBe(componentStack);
  });
});

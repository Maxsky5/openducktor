import { describe, expect, test } from "bun:test";
import {
  TERMINAL_ID_MAX_LENGTH,
  terminalCloseRequestSchema,
  terminalCloseResponseSchema,
  terminalIdSchema,
  terminalLaunchSpecSchema,
  terminalListFilterSchema,
  terminalPreparePathInputRequestSchema,
  terminalPreparePathInputResponseSchema,
  terminalSummarySchema,
} from "./terminal-schemas";

describe("terminal schemas", () => {
  test("bounds opaque terminal ids", () => {
    expect(terminalIdSchema.parse("a".repeat(TERMINAL_ID_MAX_LENGTH))).toHaveLength(
      TERMINAL_ID_MAX_LENGTH,
    );
    expect(() => terminalIdSchema.parse("a".repeat(TERMINAL_ID_MAX_LENGTH + 1))).toThrow();
  });

  test("requires a nonblank initial directory and explicit context", () => {
    expect(terminalLaunchSpecSchema.parse({ workingDir: "/repo", context: {} })).toEqual({
      workingDir: "/repo",
      context: {},
    });
    expect(() => terminalLaunchSpecSchema.parse({ workingDir: " ", context: {} })).toThrow();
    expect(() => terminalLaunchSpecSchema.parse({ workingDir: "/repo" })).toThrow();
  });

  test("keeps all, task, and unassociated filters distinct", () => {
    expect(terminalListFilterSchema.parse({ kind: "all" })).toEqual({ kind: "all" });
    expect(terminalListFilterSchema.parse({ kind: "unassociated" })).toEqual({
      kind: "unassociated",
    });
    expect(terminalListFilterSchema.parse({ kind: "task", taskId: "task-1" })).toEqual({
      kind: "task",
      taskId: "task-1",
    });
    expect(() => terminalListFilterSchema.parse({ kind: "task", taskId: "" })).toThrow();
  });

  test("requires explicit termination confirmation input", () => {
    expect(() => terminalCloseRequestSchema.parse({ terminalId: "terminal-1" })).toThrow();
  });

  test("distinguishes a completed close from a required confirmation", () => {
    expect(terminalCloseResponseSchema.parse({ closed: true })).toEqual({ closed: true });
    expect(
      terminalCloseResponseSchema.parse({ closed: false, confirmationRequired: true }),
    ).toEqual({ closed: false, confirmationRequired: true });
  });

  test("bounds terminal path-input preparation", () => {
    expect(
      terminalPreparePathInputRequestSchema.parse({
        terminalId: "terminal-1",
        paths: ["/tmp/first image.png", "/tmp/second.png"],
      }),
    ).toEqual({
      terminalId: "terminal-1",
      paths: ["/tmp/first image.png", "/tmp/second.png"],
    });
    expect(() =>
      terminalPreparePathInputRequestSchema.parse({ terminalId: "terminal-1", paths: [] }),
    ).toThrow();
    expect(() =>
      terminalPreparePathInputRequestSchema.parse({
        terminalId: "terminal-1",
        paths: Array.from({ length: 9 }, (_, index) => `/tmp/${index}.png`),
      }),
    ).toThrow();
    expect(terminalPreparePathInputResponseSchema.parse({ text: "'/tmp/image.png'" })).toEqual({
      text: "'/tmp/image.png'",
    });
  });

  test("rejects malformed and legacy summary state", () => {
    expect(() =>
      terminalSummarySchema.parse({
        terminalId: "terminal-1",
        hostInstanceId: "host-1",
        label: "Shell 1",
        context: {},
        initialWorkingDir: "/repo",
        createdAt: "2026-07-12T00:00:00.000Z",
        lifecycle: "running",
        exit: null,
      }),
    ).toThrow();
  });
});

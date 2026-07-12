import { describe, expect, test } from "bun:test";
import {
  terminalCloseRequestSchema,
  terminalLaunchSpecSchema,
  terminalListFilterSchema,
  terminalSummarySchema,
} from "./terminal-schemas";

describe("terminal schemas", () => {
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

  test("rejects malformed summary state", () => {
    expect(() =>
      terminalSummarySchema.parse({
        terminalId: "terminal-1",
        hostInstanceId: "host-1",
        label: "Shell 1",
        context: {},
        initialWorkingDir: "/repo",
        initialWorkingDirAvailable: true,
        createdAt: "2026-07-12T00:00:00.000Z",
        lifecycle: "missing",
        connectionState: "connected",
        attentionState: "none",
        exit: null,
      }),
    ).toThrow();
  });
});

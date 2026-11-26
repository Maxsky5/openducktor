import { expect, test } from "bun:test";
import type { StartupOperationSnapshot, StartupStep } from "@openducktor/contracts";
import type { StartupAttempt } from "./startup-attempt-store";
import {
  startupActiveStep,
  startupFailureRows,
  startupHasWarningOrFailure,
  startupStepCounts,
  startupTraceRows,
} from "./startup-trace";

const step = (id: string, extra: Partial<StartupStep> = {}): StartupStep => ({
  id,
  label: id,
  state: "completed",
  details: [],
  ...extra,
});

const createdWorktree = (): StartupStep =>
  step("checkout", {
    label: "Create workspace worktree",
    resources: [{ kind: "worktree", value: "/worktree", state: "created" }],
  });

const operation = (operationId: string, steps: StartupStep[]): StartupOperationSnapshot => ({
  context: { startupAttemptId: "attempt", operationId },
  hostInstanceId: "host",
  revision: 1,
  workspaceId: "workspace",
  repoPath: "/repo",
  scope: { kind: "workspace" },
  phase: "completed",
  steps,
  ownership: { state: "unknown" },
});

const attempt = (
  operations: StartupOperationSnapshot[],
  overrides: Partial<StartupAttempt> = {},
): StartupAttempt => ({
  id: "attempt",
  origin: { workspaceId: "workspace", repoPath: "/repo", scope: { kind: "workspace" } },
  label: "Start chat",
  status: { phase: "ready", confirmation: "current" },
  operations,
  ownership: { state: "unknown" },
  instructionRequired: false,
  presentation: "inline",
  ...overrides,
});

test("shows Submitting request while pending before snapshot #1 arrives", () => {
  const pending = attempt([], { status: { phase: "submitting", confirmation: "current" } });
  expect(startupTraceRows(pending)).toEqual([
    {
      id: "attempt:submitting",
      step: { id: "submitting", label: "Submitting request", state: "running", details: [] },
    },
  ]);
  expect(startupStepCounts(pending)).toEqual({ completed: 0, total: 1 });
});

test("keeps Submitting request while pending when only internal bookkeeping steps arrived", () => {
  const pending = attempt(
    [operation("launch", [step("checks", { state: "running", label: "Check prerequisites" })])],
    { status: { phase: "running", confirmation: "current" } },
  );
  expect(startupTraceRows(pending)).toEqual([
    {
      id: "attempt:submitting",
      step: { id: "submitting", label: "Submitting request", state: "running", details: [] },
    },
  ]);
  expect(startupStepCounts(pending)).toEqual({ completed: 0, total: 1 });
});

test.each(["removed", "retained", "unknown"] as const)(
  "keeps captured output when cleanup reports the worktree as %s",
  (state) => {
    const action = {
      actionId: "setup",
      command: "bun install",
      waitBeforeAgentStart: true,
      terminalId: "setup-terminal",
      result: {
        type: "exited" as const,
        exitCode: 1,
        signal: null,
        outputTail: ["Setup failed before cleanup"],
      },
    };
    const startup = attempt([
      operation("create", [
        createdWorktree(),
        step("action:setup", { state: "failed", action }),
        step("cleanup", {
          resources: [{ kind: "worktree", value: "/worktree", state }],
        }),
      ]),
    ]);

    for (const rows of [startupTraceRows(startup), startupFailureRows(startup)]) {
      const shown = rows.find((row) => row.id === "create:action:setup")!.step.action!;
      expect(shown.terminalId).toBe(state === "removed" ? undefined : "setup-terminal");
      expect(shown.result?.outputTail).toEqual(["Setup failed before cleanup"]);
    }
    expect(action.terminalId).toBe("setup-terminal");
  },
);

test("projects user-facing steps directly and hides routine internal bookkeeping steps", () => {
  const startup = attempt(
    [
      operation("launch", [
        step("request"),
        step("checks"),
        step("naming"),
        createdWorktree(),
        step("upstream"),
        step("copies", { details: [".env"] }),
        step("action:install", {
          action: { actionId: "install", command: "bun install", waitBeforeAgentStart: true },
        }),
        step("save"),
        step("prepare", { label: "Start session" }),
        step("publish"),
        step("handoff"),
        step("instruction", { label: "Submit initial instruction" }),
      ]),
    ],
    { instructionRequired: true },
  );

  expect(startupTraceRows(startup).map((row) => row.id)).toEqual([
    "launch:naming",
    "launch:checkout",
    "launch:upstream",
    "launch:copies",
    "launch:action:install",
    "launch:prepare",
    "launch:instruction",
  ]);
  expect(startupStepCounts(startup)).toEqual({ completed: 7, total: 7 });
  expect(startupHasWarningOrFailure(startup)).toBe(false);
});

test("projects structured user-facing steps for non-worktree starts", () => {
  const startup = attempt(
    [
      operation("launch", [
        step("request"),
        step("checks"),
        step("checkout", { label: "Use current checkout", details: ["/repo"] }),
        step("save"),
        step("prepare", { label: "Start session", state: "running" }),
        step("instruction", { label: "Submit initial instruction", state: "pending" }),
      ]),
    ],
    {
      instructionRequired: true,
      status: { phase: "running", confirmation: "current" },
    },
  );

  expect(startupTraceRows(startup).map(({ id, step }) => [id, step.label, step.state])).toEqual([
    ["launch:checkout", "Use current checkout", "completed"],
    ["launch:prepare", "Start session", "running"],
    ["launch:instruction", "Submit initial instruction", "pending"],
  ]);
  expect(startupStepCounts(startup)).toEqual({ completed: 1, total: 3 });
  expect(startupActiveStep(startupTraceRows(startup))?.id).toBe("prepare");
});

test("includes internal steps when they fail or carry a warning", () => {
  const startup = attempt(
    [
      operation("launch", [
        step("request"),
        step("save", {
          state: "failed",
          failure: {
            stage: "save",
            code: "startup_failed",
            message: "SQLite busy",
            nextAction: "Retry",
          },
        }),
      ]),
    ],
    { status: { phase: "failed", confirmation: "current" } },
  );

  expect(startupTraceRows(startup).map((row) => row.id)).toEqual(["launch:save"]);
  expect(startupHasWarningOrFailure(startup)).toBe(true);
});

test("detects step warnings for expanded warning presentation", () => {
  const startup = attempt([
    operation("launch", [
      step("naming", { warning: "Naming model timed out; used fallback branch." }),
      createdWorktree(),
      step("prepare"),
    ]),
  ]);

  expect(startupHasWarningOrFailure(startup)).toBe(true);
  expect(startupActiveStep(startupTraceRows(startup))?.id).toBe("naming");
});

test.each(["pending", "completed", "failed"] as const)(
  "an empty %s copy list adds no routine row unless failed",
  (state) => {
    const rows = startupTraceRows(
      attempt([operation("create", [createdWorktree(), step("copies", { state })])]),
    );

    expect(rows.map((row) => row.id)).toEqual(
      state === "failed" ? ["create:checkout", "create:copies"] : ["create:checkout"],
    );
  },
);

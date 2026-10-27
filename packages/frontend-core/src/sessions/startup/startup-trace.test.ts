import { expect, test } from "bun:test";
import type { StartupOperationSnapshot, StartupStep } from "@openducktor/contracts";
import type { StartupAttempt } from "./startup-attempt-store";
import { startupFailureRows, startupTraceRows } from "./startup-trace";

const step = (id: string, extra: Partial<StartupStep> = {}): StartupStep => ({
  id,
  label: id,
  state: "completed",
  details: [],
  ...extra,
});

const createdWorktree = (): StartupStep =>
  step("checkout", {
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

const attempt = (operations: StartupOperationSnapshot[]): StartupAttempt => ({
  id: "attempt",
  origin: { workspaceId: "workspace", repoPath: "/repo", scope: { kind: "workspace" } },
  label: "Start chat",
  status: { phase: "ready", confirmation: "current" },
  operations,
  ownership: { state: "unknown" },
  instructionRequired: false,
  presentation: "dialog",
});

test("projects only worktree setup in execution order", () => {
  const startup = attempt([
    operation("create", [
      step("readiness"),
      createdWorktree(),
      step("upstream"),
      step("copies", { details: [".env"] }),
      step("install", {
        action: { actionId: "install", command: "bun install", waitBeforeAgentStart: true },
      }),
      step("save"),
      step("publish"),
      step("cleanup"),
    ]),
    operation("prepare", [step("native"), step("handoff")]),
  ]);

  expect(startupTraceRows(startup).map((row) => row.id)).toEqual([
    "create:checkout",
    "create:upstream",
    "create:copies",
    "create:install",
    "create:cleanup",
  ]);
  expect(startup.operations.map((entry) => entry.steps.length)).toEqual([8, 2]);
});

test.each(["pending", "completed", "failed"] as const)(
  "an empty %s copy list adds no routine row after worktree creation",
  (state) => {
    const rows = startupTraceRows(
      attempt([operation("create", [createdWorktree(), step("copies", { state })])]),
    );

    expect(rows.map((row) => row.id)).toEqual(
      state === "failed" ? ["create:checkout", "create:copies"] : ["create:checkout"],
    );
  },
);

test.each(["pending", "not_run", "failed"] as const)(
  "a %s worktree without confirmed creation has no step trace",
  (state) => {
    const startup = attempt([
      operation("create", [
        step("checkout", { state }),
        step("copies", { state: state === "pending" ? "pending" : "not_run", details: [".env"] }),
      ]),
    ]);

    expect(startupTraceRows(startup)).toEqual([]);
    expect(startupFailureRows(startup).map((row) => row.id)).toEqual(
      state === "failed" ? ["create:checkout"] : [],
    );
  },
);

test.each(["completed", "failed"] as const)(
  "a later %s checkout validation does not add a creation row unless it fails",
  (state) => {
    const rows = startupTraceRows(
      attempt([
        operation("create", [createdWorktree(), step("copies")]),
        operation("start", [
          step("checkout", {
            state,
            resources: [{ kind: "worktree", value: "/worktree", state: "reused" }],
          }),
        ]),
      ]),
    );

    expect(rows.map((row) => row.id)).toEqual(
      state === "failed" ? ["create:checkout", "start:checkout"] : ["create:checkout"],
    );
  },
);

test.each([
  [
    "a reused worktree",
    step("checkout", {
      resources: [{ kind: "worktree", value: "/worktree", state: "reused" }],
    }),
  ],
  ["the current checkout", step("readiness")],
] as const)("%s has no worktree creation trace, including failures", (_location, firstStep) => {
  expect(
    startupTraceRows(
      attempt([
        operation("start", [
          firstStep,
          step("native", { state: "failed" }),
          step("action", {
            action: {
              actionId: "action",
              command: "bun install",
              waitBeforeAgentStart: false,
              result: { type: "failed", message: "Setup failed", outputTail: [] },
            },
          }),
        ]),
      ]),
    ),
  ).toEqual([]);
});

test("keeps late action results and failure facts after creation is ready", () => {
  const startup = attempt([
    operation("create", [
      createdWorktree(),
      step("setup", {
        action: { actionId: "setup", command: "bun install", waitBeforeAgentStart: false },
      }),
    ]),
    operation("prepare", [
      step("native", {
        failure: {
          stage: "prepare",
          code: "native_failed",
          message: "Session preparation failed",
          nextAction: "Open the session to inspect it.",
        },
      }),
    ]),
  ]);
  const action = startup.operations[0]!.steps.find((entry) => entry.id === "setup")!.action!;
  action.result = { type: "exited", exitCode: 1, signal: null, outputTail: ["Setup failed"] };

  const rows = startupTraceRows(startup);

  expect(rows.map((row) => row.id)).toEqual(["create:checkout", "create:setup", "prepare:native"]);
  expect(rows[1]?.step.action?.result).toEqual({
    type: "exited",
    exitCode: 1,
    signal: null,
    outputTail: ["Setup failed"],
  });
  expect(rows[2]?.step.failure?.message).toBe("Session preparation failed");
  expect(startupFailureRows(startup).map((row) => row.id)).toEqual([
    "create:setup",
    "prepare:native",
  ]);
});

test("keeps checkout cleanup guidance when a current-checkout fork cannot confirm Stop", () => {
  const startup = attempt([
    operation("fork", [
      step("checkout"),
      step("cleanup", {
        state: "failed",
        details: ["The native fork did not confirm Stop. Keep its checkout until Stop succeeds."],
        resources: [
          {
            kind: "worktree",
            value: "/repo",
            state: "retained",
            nextAction: "Stop native session child before removing this checkout.",
          },
        ],
      }),
    ]),
  ]);

  expect(startupTraceRows(startup)).toEqual([]);
  const rows = startupFailureRows(startup);
  expect(rows.map((row) => row.id)).toEqual(["fork:cleanup"]);
  expect(rows[0]?.step.details).toEqual([
    "The native fork did not confirm Stop. Keep its checkout until Stop succeeds.",
  ]);
  expect(rows[0]?.step.resources).toEqual([
    {
      kind: "worktree",
      value: "/repo",
      state: "retained",
      nextAction: "Stop native session child before removing this checkout.",
    },
  ]);
});

test("keeps unsettled resources and next actions without showing routine completed steps", () => {
  const rows = startupFailureRows(
    attempt([
      operation("start", [
        step("readiness"),
        step("removed", {
          resources: [{ kind: "worktree", value: "/removed", state: "removed" }],
        }),
        step("retained", {
          resources: [{ kind: "worktree", value: "/retained", state: "retained" }],
        }),
        step("unknown", {
          resources: [{ kind: "worktree", value: "/unknown", state: "unknown" }],
        }),
        step("next-action", {
          resources: [
            { kind: "branch", value: "feature", state: "created", nextAction: "Inspect branch." },
          ],
        }),
        step("successful-action", {
          action: {
            actionId: "setup",
            command: "bun install",
            waitBeforeAgentStart: true,
            result: { type: "exited", exitCode: 0, signal: null, outputTail: [] },
          },
        }),
      ]),
    ]),
  );

  expect(rows.map((row) => row.id)).toEqual([
    "start:retained",
    "start:unknown",
    "start:next-action",
  ]);
});

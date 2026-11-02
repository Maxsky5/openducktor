import { expect, test } from "bun:test";
import type { StartupOperationSnapshot, StartupStep } from "@openducktor/contracts";
import type { StartupAttempt } from "./startup-attempt-store";
import { startupActiveStep, startupFailureRows, startupTraceRows } from "./startup-trace";

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
        step("setup", { state: "failed", action }),
        step("cleanup", {
          resources: [{ kind: "worktree", value: "/worktree", state }],
        }),
      ]),
    ]);

    for (const rows of [startupTraceRows(startup), startupFailureRows(startup)]) {
      const shown = rows.find((row) => row.id === "create:setup")!.step.action!;
      expect(shown.terminalId).toBe(state === "removed" ? undefined : "setup-terminal");
      expect(shown.result?.outputTail).toEqual(["Setup failed before cleanup"]);
    }
    expect(action.terminalId).toBe("setup-terminal");
  },
);

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
    "attempt:session",
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
      state === "failed"
        ? ["create:checkout", "create:copies", "attempt:session"]
        : ["create:checkout", "attempt:session"],
    );
  },
);

test.each(["pending", "running", "completed"] as const)(
  "a %s worktree creation shows every planned setup step at once",
  (state) => {
    const startup = attempt([
      operation("create", [
        step("checkout", { state }),
        step("upstream", { state: "pending" }),
        step("copies", { state: "pending", details: [".env"] }),
        step("install", {
          state: "pending",
          action: { actionId: "install", command: "bun install", waitBeforeAgentStart: true },
        }),
      ]),
    ]);

    expect(startupTraceRows(startup).map((row) => row.id)).toEqual([
      "create:checkout",
      "create:upstream",
      "create:copies",
      "create:install",
      "attempt:session",
    ]);
  },
);

test("a running checkout of a reused worktree has no step trace", () => {
  const startup = attempt([
    operation("start", [
      step("checkout", {
        state: "running",
        resources: [{ kind: "worktree", value: "/worktree", state: "reused" }],
      }),
    ]),
  ]);

  expect(startupTraceRows(startup)).toEqual([]);
});

test.each(["not_run", "failed"] as const)(
  "a %s worktree without confirmed creation has no step trace",
  (state) => {
    const startup = attempt([
      operation("create", [
        step("checkout", { state }),
        step("copies", { state: "not_run", details: [".env"] }),
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
      state === "failed"
        ? ["create:checkout", "start:checkout", "attempt:session"]
        : ["create:checkout", "attempt:session"],
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

  expect(rows.map((row) => row.id)).toEqual([
    "create:checkout",
    "create:setup",
    "prepare:native",
    "attempt:session",
  ]);
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

const sessionState = (
  setup: StartupStep[],
  status: StartupAttempt["status"],
): StartupStep["state"] | undefined =>
  startupTraceRows({ ...attempt([operation("create", setup)]), status }).at(-1)?.step.state;

const running = { phase: "running", confirmation: "current" } as const;

/** An action that runs on in its terminal exited with an error. The session start goes on. */
const devServerFailed = (): StartupStep =>
  step("dev", {
    state: "failed",
    failure: {
      stage: "dev",
      code: "action_failed",
      message: "Dev server exited with code 1.",
      nextAction: "Open the action terminal to inspect it.",
    },
    action: {
      actionId: "dev",
      command: "bun dev",
      waitBeforeAgentStart: false,
      result: { type: "exited", exitCode: 1, signal: null, outputTail: [] },
    },
  });

test.each([
  [
    "a setup step runs",
    [createdWorktree(), step("copies", { state: "running", details: [".env"] })],
    running,
    "pending",
  ],
  ["setup is complete", [createdWorktree()], running, "running"],
  [
    "only an action that continues in its terminal runs",
    [
      createdWorktree(),
      step("dev", {
        state: "running",
        action: { actionId: "dev", command: "bun dev", waitBeforeAgentStart: false },
      }),
    ],
    running,
    "running",
  ],
  [
    "a blocking action runs",
    [
      createdWorktree(),
      step("install", {
        state: "running",
        action: { actionId: "install", command: "bun install", waitBeforeAgentStart: true },
      }),
    ],
    running,
    "pending",
  ],
  [
    "the session is ready",
    [createdWorktree()],
    { phase: "ready", confirmation: "current" },
    "completed",
  ],
  [
    "the ready session is unconfirmed",
    [createdWorktree()],
    { phase: "ready", confirmation: "unconfirmed" },
    "running",
  ],
  [
    "a setup step failed",
    [createdWorktree(), step("copies", { state: "failed", details: [".env"] })],
    { phase: "failed", confirmation: "current" },
    "not_run",
  ],
  [
    "the session start failed",
    [createdWorktree()],
    { phase: "failed", confirmation: "current" },
    "failed",
  ],
  [
    "the successful start settles",
    [createdWorktree()],
    { phase: "settling", confirmation: "current" },
    "running",
  ],
  [
    "the start settles after a setup failure",
    [createdWorktree(), step("copies", { state: "failed", details: [".env"] })],
    { phase: "settling", confirmation: "current" },
    "not_run",
  ],
  [
    "the start settles after an action that continues in its terminal failed",
    [createdWorktree(), devServerFailed()],
    { phase: "settling", confirmation: "current" },
    "running",
  ],
  [
    "the session start failed after an action that continues in its terminal failed",
    [createdWorktree(), devServerFailed()],
    { phase: "failed", confirmation: "current" },
    "failed",
  ],
  [
    "the start was canceled",
    [createdWorktree()],
    { phase: "canceled", confirmation: "current" },
    "not_run",
  ],
] as const)("the session row follows the attempt when %s", (_name, setup, status, expected) => {
  expect(sessionState([...setup], status)).toBe(expected);
});

const activeStep = (steps: StartupStep[]) =>
  startupActiveStep(startupTraceRows(attempt([operation("create", steps)])))?.id;

test("the active step stays on the next pending step between two steps", () => {
  expect(
    activeStep([
      createdWorktree(),
      step("upstream", { state: "pending" }),
      step("copies", { state: "pending", details: [".env"] }),
    ]),
  ).toBe("upstream");
});

test("the active step is the last step that runs or failed", () => {
  const install = {
    actionId: "install",
    command: "bun install",
    waitBeforeAgentStart: true,
  } as const;
  expect(
    activeStep([
      createdWorktree(),
      step("install", { state: "running", action: install }),
      step("dev", { state: "pending", action: { ...install, actionId: "dev" } }),
    ]),
  ).toBe("install");
  expect(
    activeStep([
      createdWorktree(),
      step("copies", { state: "failed", details: [".env"] }),
      step("install", { state: "not_run", action: install }),
    ]),
  ).toBe("copies");
});

import { describe, expect, test } from "bun:test";
import { STARTING_ACTIVITY, startupToastTitles } from "./replicas/shell/StartupToast";
import { REPOSITORY_PATH } from "./sample/workspace";
import { ORIGIN, STEPS } from "./scenes/chat/sample";
import { PLANNER_ORIGIN } from "./scenes/palette/sample";
import { importProduct } from "./test-support/product-source";

type Phase = "running" | "ready";
type Step = {
  id: string;
  label: string;
  state: "pending" | "completed";
  details: string[];
  resources?: { kind: "worktree"; value: string; state: "created" }[];
};
type Attempt = {
  id: string;
  origin: { repoPath: string; scope: { kind: "task"; taskId: string } };
  roleLabel: string;
  status: { phase: Phase };
  operations: { context: { operationId: string }; steps: Step[] }[];
};

// SAFETY: startup-summary.ts exports these functions, and a missing export fails the test.
const summary = await importProduct<{
  startupTitle: (attempt: Attempt) => string;
  startupOrigin: (attempt: Attempt) => string;
  startupActivity: (attempt: Attempt) => string | undefined;
}>("packages/frontend/src/features/session-startup/startup-summary.ts");
// SAFETY: startup-trace.ts exports this function, and a missing export fails the test.
const { startupTraceRows } = await importProduct<{
  startupTraceRows: (attempt: Attempt) => { step: { label: string } }[];
}>("packages/frontend-core/src/sessions/startup/startup-trace.ts");

/** A start of the task `task` in the background, with the steps of `steps`. */
const attempt = (role: string, task: string, phase: Phase, steps: Step[] = []): Attempt => ({
  id: "attempt",
  origin: { repoPath: REPOSITORY_PATH, scope: { kind: "task", taskId: task } },
  roleLabel: role,
  status: { phase },
  operations: steps.length > 0 ? [{ context: { operationId: "build" }, steps }] : [],
});

/** The host plan of a new task worktree: the copy step without paths does not show. */
const plan: Step[] = [
  {
    id: "checkout",
    label: "Create task worktree",
    state: "completed",
    details: [],
    resources: [{ kind: "worktree", value: "/worktree", state: "created" }],
  },
  { id: "upstream", label: "Set branch upstream", state: "completed", details: [] },
  { id: "copies", label: "Copy configured files", state: "completed", details: [] },
];

describe("the startup notification copied from the app", () => {
  test("the title names the role while the session starts and when it is ready", () => {
    const titles = startupToastTitles("Builder");
    expect(summary.startupTitle(attempt("Builder", "fieldnotes-w5j3", "running"))).toBe(
      titles.running,
    );
    expect(summary.startupTitle(attempt("Builder", "fieldnotes-w5j3", "ready"))).toBe(titles.ready);
  });

  test("the origin names the repository and the task", () => {
    expect(summary.startupOrigin(attempt("Builder", "fieldnotes-w5j3", "running"))).toBe(ORIGIN);
    expect(summary.startupOrigin(attempt("Planner", "fieldnotes-h5w3", "running"))).toBe(
      PLANNER_ORIGIN,
    );
  });

  test("a start without a new worktree shows its activity", () => {
    expect(summary.startupActivity(attempt("Planner", "fieldnotes-h5w3", "running"))).toBe(
      STARTING_ACTIVITY,
    );
  });

  test("a new task worktree shows its steps, then the session start", () => {
    const rows = startupTraceRows(attempt("Builder", "fieldnotes-w5j3", "running", plan));
    expect(rows.map(({ step }) => step.label)).toEqual(STEPS.map((step) => step.label));
  });
});

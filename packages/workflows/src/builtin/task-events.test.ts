import { describe, expect, test } from "bun:test";
import { loadWorkflowContractFixture } from "../../test-support/workflow-contract-fixture";
import {
  BUILTIN_ACTIONS,
  BUILTIN_AUTOMATIONS,
  BUILTIN_LAUNCH_ACTIONS,
  BUILTIN_ROLES,
  BUILTIN_SIGNALS,
  BUILTIN_STATES,
  BUILTIN_STEPS,
  builtinWorkflow,
  type BuiltinTaskEventId,
} from "./definition";
import { decideTaskEvent, isTaskEventAvailable } from "./task-events";
import { builtinTaskWorkflow } from "./task-workflow";
import type { BuiltinTask } from "./facts";
import {
  BUILTIN_ACTION_IDS,
  BUILTIN_AUTOMATION_IDS,
  BUILTIN_ISSUE_TYPE_IDS,
  BUILTIN_LAUNCH_ACTION_IDS,
  BUILTIN_PROMPT_TEMPLATE_IDS,
  BUILTIN_ROLE_IDS,
  BUILTIN_SIGNAL_IDS,
  BUILTIN_STATE_IDS,
  type BuiltinIssueTypeId,
  type BuiltinStateId,
} from "./ids";

/** The task fields that the workflow reads. */
const task = (overrides: Partial<BuiltinTask> = {}): BuiltinTask => ({
  id: "task-1",
  status: "open",
  issueType: "feature",
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
  },
  ...overrides,
});

const allowedFrom = (eventId: BuiltinTaskEventId, issueType: BuiltinIssueTypeId) =>
  BUILTIN_STATE_IDS.filter((status) => isTaskEventAvailable(eventId, task({ status, issueType })));

describe("built-in definition", () => {
  test("declares every task action and one agent step per role, in order", () => {
    expect(BUILTIN_ACTIONS.map(({ id }) => id).toSorted()).toEqual(
      [...BUILTIN_ACTION_IDS].toSorted(),
    );
    expect(BUILTIN_STEPS.map(({ roleId }) => roleId)).toEqual([...BUILTIN_ROLE_IDS]);
  });

  test("lists the IDs of the definition", () => {
    expect(BUILTIN_ROLES.map(({ id }) => id)).toEqual([...BUILTIN_ROLE_IDS]);
    expect(BUILTIN_STATES.map(({ id }) => id)).toEqual([...BUILTIN_STATE_IDS]);
    expect(builtinWorkflow.definition.facts).toEqual([
      { id: "issueType", type: "enum", values: [...BUILTIN_ISSUE_TYPE_IDS] },
    ]);
    expect(BUILTIN_LAUNCH_ACTIONS.map(({ id }) => id)).toEqual([...BUILTIN_LAUNCH_ACTION_IDS]);
    expect(BUILTIN_SIGNALS.map(({ id }) => id)).toEqual([...BUILTIN_SIGNAL_IDS]);
    expect(BUILTIN_AUTOMATIONS.map(({ id }) => id)).toEqual([...BUILTIN_AUTOMATION_IDS]);
    expect(
      BUILTIN_LAUNCH_ACTIONS.every(({ template }) =>
        BUILTIN_PROMPT_TEMPLATE_IDS.some((id) => id === template.id),
      ),
    ).toBe(true);
    expect(BUILTIN_STATES.flatMap(({ notification }) => notification?.kind ?? [])).toEqual(
      BUILTIN_STATE_IDS.filter((status) => status !== "open").map((status) => `workflow.${status}`),
    );
  });
});

describe("built-in transition signals", () => {
  test.each([
    [
      "set-spec",
      "open",
      undefined,
      { to: "spec_ready", cause: { signal: "taskProgressedToSpecReady" } },
    ],
    [
      "set-plan",
      "spec_ready",
      undefined,
      { to: "ready_for_dev", cause: { signal: "taskProgressedToReadyForDev" } },
    ],
    [
      "build-completed",
      "in_progress",
      undefined,
      { to: "ai_review", cause: { signal: "taskProgressedToAiReview" } },
    ],
    [
      "build-completed",
      "blocked",
      "approved",
      { to: "human_review", cause: { signal: "taskProgressedToHumanReview", sourceRole: "build" } },
    ],
    [
      "qa-approved",
      "ai_review",
      undefined,
      { to: "human_review", cause: { signal: "taskProgressedToHumanReview", sourceRole: "qa" } },
    ],
    [
      "qa-rejected",
      "ai_review",
      undefined,
      { to: "in_progress", cause: { signal: "taskRejectedByQa" } },
    ],
    ["reset-implementation", "in_progress", undefined, { to: "spec_ready", cause: {} }],
    ["human-request-changes", "human_review", undefined, { to: "in_progress", cause: {} }],
    ["direct-merge-publish", "ai_review", undefined, { to: "human_review", cause: {} }],
    ["build-resumed", "blocked", undefined, { to: "in_progress", cause: {} }],
    ["set-status:ai_review", "in_progress", undefined, { to: "ai_review", cause: {} }],
    ["build-blocked", "in_progress", undefined, { to: "blocked", cause: {} }],
  ] as const)("%s from %s reports %o", (eventId, from, verdict, expected) => {
    const current = task({
      status: from,
      artifactSummary: {
        spec: { present: true },
        plan: { present: from !== "in_progress" },
        qaReport: verdict === undefined ? { present: false } : { present: true, verdict },
      },
    });
    expect(decideTaskEvent(eventId, current)).toEqual({ kind: "transition", from, ...expected });
  });
});

describe("built-in task events", () => {
  test("direct status events and approval match the workflow contract graph", () => {
    const fixture = loadWorkflowContractFixture();
    for (const issueType of BUILTIN_ISSUE_TYPE_IDS) {
      for (const from of BUILTIN_STATE_IDS) {
        const current = task({ issueType, status: from });
        const reachable = BUILTIN_STATE_IDS.filter((to) => {
          const eventId = to === "closed" ? "human-approve" : builtinTaskWorkflow.statusEvent(to);
          return (
            eventId !== undefined &&
            builtinTaskWorkflow.decide(eventId, current).kind === "transition"
          );
        });
        expect({ issueType, from, reachable }).toEqual({
          issueType,
          from,
          reachable: fixture.transitions[issueType][from].toSorted(
            (left, right) => BUILTIN_STATE_IDS.indexOf(left) - BUILTIN_STATE_IDS.indexOf(right),
          ),
        });
      }
    }
  });

  test("document and reset events match the workflow contract statuses", () => {
    const fixture = loadWorkflowContractFixture();
    for (const issueType of BUILTIN_ISSUE_TYPE_IDS) {
      expect(allowedFrom("set-spec", issueType)).toEqual(fixture.setSpecAllowedStatuses);
      expect(allowedFrom("set-plan", issueType)).toEqual(fixture.setPlanAllowedStatuses[issueType]);
      expect(allowedFrom("reset-implementation", issueType)).toEqual(
        fixture.resetImplementationAllowedStatuses,
      );
      expect(allowedFrom("reset-task", issueType)).toEqual(fixture.resetTaskAllowedStatuses);
    }
  });

  test("the direct status API has no event for closed and keeps same-status repeats", () => {
    expect(builtinTaskWorkflow.statusEvent("closed")).toBeUndefined();
    for (const status of BUILTIN_STATE_IDS.filter((status) => status !== "closed")) {
      const eventId = builtinTaskWorkflow.statusEvent(status);
      expect(eventId).toBe(`set-status:${status}`);
      if (eventId === undefined) throw new Error(`Expected a direct status event for ${status}.`);
      expect(builtinTaskWorkflow.decide(eventId, task({ status, issueType: "task" }))).toEqual({
        kind: "unchanged",
        status,
      });
    }
  });

  test("named commands use their outcomes and keep valid repeats unchanged", () => {
    const cases: [BuiltinTaskEventId, BuiltinStateId, BuiltinStateId][] = [
      ["build-blocked", "in_progress", "blocked"],
      ["build-blocked", "blocked", "blocked"],
      ["build-resumed", "ready_for_dev", "in_progress"],
      ["build-resumed", "in_progress", "in_progress"],
      ["human-request-changes", "ai_review", "in_progress"],
      ["human-request-changes", "in_progress", "in_progress"],
      ["human-approve", "human_review", "closed"],
      ["human-approve", "closed", "closed"],
      ["close-task", "open", "closed"],
      ["close-task", "closed", "closed"],
      ["reset-task", "blocked", "open"],
      ["complete-direct-merge", "human_review", "closed"],
      ["complete-direct-merge", "closed", "closed"],
      ["close-merged-pull-request", "ai_review", "closed"],
      ["close-merged-pull-request", "closed", "closed"],
      ["direct-merge-local", "ai_review", "closed"],
      ["direct-merge-publish", "ai_review", "human_review"],
      ["direct-merge-publish", "human_review", "human_review"],
      ["qa-approved", "blocked", "human_review"],
      ["qa-rejected", "ai_review", "in_progress"],
    ];
    for (const [eventId, status, destination] of cases) {
      const decision = decideTaskEvent(eventId, task({ status }));
      expect({ eventId, status, decision }).toMatchObject({
        eventId,
        status,
        decision:
          status === destination
            ? { kind: "unchanged", status }
            : { kind: "transition", from: status, to: destination },
      });
    }
  });

  test("denials name allowed statuses or missing planning", () => {
    expect(decideTaskEvent("human-request-changes", task({ status: "blocked" }))).toEqual({
      kind: "denied",
      reason: "status",
      status: "blocked",
      allowedStatuses: ["in_progress", "ai_review", "human_review"],
    });
    expect(decideTaskEvent("build-resumed", task({ status: "spec_ready" }))).toEqual({
      kind: "denied",
      reason: "planning",
      status: "spec_ready",
      allowedStatuses: ["ready_for_dev", "in_progress", "blocked", "ai_review", "human_review"],
    });
    expect(decideTaskEvent("set-plan", task({ status: "open" }))).toMatchObject({
      reason: "planning",
      allowedStatuses: fixturePlanStatuses("feature"),
    });
    for (const status of ["open", "spec_ready", "ready_for_dev"] as const) {
      expect(decideTaskEvent("human-request-changes", task({ status })).kind).toBe("denied");
    }
  });

  test("build completion uses stored QA approval and keeps completed reviews unchanged", () => {
    const cases = [
      [{ present: false }, "ai_review"],
      [{ present: true, verdict: "rejected" }, "ai_review"],
      [{ present: true, verdict: "approved" }, "human_review"],
    ] as const;
    for (const [qaReport, to] of cases) {
      for (const from of ["in_progress", "blocked"] as const) {
        const current = task({ status: from });
        current.artifactSummary = { ...current.artifactSummary, qaReport };
        expect(decideTaskEvent("build-completed", current)).toMatchObject({
          kind: "transition",
          from,
          to,
        });
      }
    }
    for (const status of ["ai_review", "human_review"] as const) {
      expect(decideTaskEvent("build-completed", task({ status })).kind).toBe("unchanged");
    }
    for (const status of ["open", "spec_ready", "ready_for_dev", "closed"] as const) {
      expect(decideTaskEvent("build-completed", task({ status })).kind).toBe("denied");
    }
  });

  test("document saves and Builder starts keep active statuses", () => {
    for (const status of ["in_progress", "blocked", "ai_review", "human_review"] as const) {
      for (const eventId of ["set-spec", "set-plan", "start-builder"] as const) {
        expect(decideTaskEvent(eventId, task({ status })).kind).toBe("unchanged");
      }
    }
    expect(decideTaskEvent("set-spec", task())).toEqual({
      kind: "transition",
      from: "open",
      to: "spec_ready",
      cause: { signal: "taskProgressedToSpecReady" },
    });
    expect(decideTaskEvent("set-plan", task({ status: "open", issueType: "bug" }))).toMatchObject({
      to: "ready_for_dev",
    });
    expect(
      decideTaskEvent("start-builder", task({ status: "open", issueType: "bug" })),
    ).toMatchObject({ to: "in_progress" });
    expect(decideTaskEvent("start-builder", task())).toMatchObject({ reason: "planning" });
    expect(decideTaskEvent("start-builder", task({ status: "closed" }))).toMatchObject({
      reason: "status",
    });
  });

  test("implementation reset follows retained documents", () => {
    const current = task({ status: "blocked" });
    expect(decideTaskEvent("reset-implementation", current)).toMatchObject({ to: "open" });
    current.artifactSummary = { ...current.artifactSummary, spec: { present: true } };
    expect(decideTaskEvent("reset-implementation", current)).toMatchObject({ to: "spec_ready" });
    current.artifactSummary = { ...current.artifactSummary, plan: { present: true } };
    expect(decideTaskEvent("reset-implementation", current)).toMatchObject({
      to: "ready_for_dev",
    });
  });
});

const fixturePlanStatuses = (issueType: BuiltinIssueTypeId) =>
  loadWorkflowContractFixture().setPlanAllowedStatuses[issueType];

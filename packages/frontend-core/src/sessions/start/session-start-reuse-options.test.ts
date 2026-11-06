import { describe, expect, test } from "bun:test";
import {
  createAgentSessionSummaryFixture,
  createTaskCardFixture,
} from "../../test-support/shared-test-fixtures";
import { editBuiltinTaskWorkflow } from "../../test-support/workflow-fixtures";
import { buildPullRequestSessionOptions } from "./session-start-reuse-options";

const session = (externalSessionId: string, role: string, startedAt: string, taskId = "TASK-1") =>
  createAgentSessionSummaryFixture({
    externalSessionId,
    startedAt,
    sessionAssociation: { kind: "workflow", workspaceId: "workspace-1", taskId, role },
  });

const sessions = [
  session("spec-1", "spec", "2026-03-21T12:00:00.000Z"),
  session("build-1", "build", "2026-03-19T12:00:00.000Z"),
  session("build-2", "build", "2026-03-20T12:00:00.000Z"),
  session("qa-1", "qa", "2026-03-22T12:00:00.000Z"),
  session("other-task", "build", "2026-03-23T12:00:00.000Z", "TASK-2"),
];

describe("buildPullRequestSessionOptions", () => {
  test("lists the task sessions of the declared pull request roles, latest first", () => {
    const task = createTaskCardFixture({ id: "TASK-1", status: "human_review" });
    expect(
      buildPullRequestSessionOptions({ task, sessions }).map(({ label, role, secondaryLabel }) => ({
        label,
        role,
        secondaryLabel,
      })),
    ).toEqual([
      { label: "Builder #2", role: "build", secondaryLabel: "Latest" },
      { label: "Builder #1", role: "build", secondaryLabel: undefined },
    ]);
  });

  test("lists every task session when the workflow names no pull request role", () => {
    const taskWorkflow = editBuiltinTaskWorkflow(({ definition }) => {
      definition.pullRequestRoles = [];
      definition.automations = definition.automations.filter(
        ({ launchActionId }) => launchActionId !== "pull_request",
      );
      for (const signal of definition.signals)
        signal.automations = signal.automations.filter((id) => id !== "startGeneratePullRequest");
    });
    const task = { ...createTaskCardFixture({ id: "TASK-1" }), taskWorkflow };
    expect(
      buildPullRequestSessionOptions({ task, sessions }).map(({ label, role }) => ({
        label,
        role,
      })),
    ).toEqual([
      { label: "QA #1", role: "qa" },
      { label: "Spec #1", role: "spec" },
      { label: "Builder #2", role: "build" },
      { label: "Builder #1", role: "build" },
    ]);
  });
});

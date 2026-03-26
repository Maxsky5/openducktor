import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import { resolveTaskCardActions } from "./kanban-task-workflow";

describe("resolveTaskCardActions", () => {
  test("prioritizes planner action over continue spec when task is spec_ready", () => {
    const task = createTaskCardFixture({
      status: "spec_ready",
      issueType: "epic",
      availableActions: ["set_spec", "set_plan"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("set_plan");
    expect(result.secondaryActions).toContain("set_spec");
  });

  test("keeps spec action priority before planner when task is not spec_ready", () => {
    const task = createTaskCardFixture({
      status: "open",
      issueType: "epic",
      availableActions: ["set_spec", "set_plan"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("set_spec");
  });

  test("keeps build-first priority for bug workflow actions", () => {
    const task = createTaskCardFixture({
      status: "open",
      issueType: "bug",
      availableActions: ["set_plan", "build_start"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("build_start");
  });

  test("uses build_start as primary for feature-ready-for-dev tasks", () => {
    const task = createTaskCardFixture({
      status: "ready_for_dev",
      issueType: "feature",
      availableActions: ["set_spec", "set_plan", "build_start"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("build_start");
  });

  test("uses build_start as primary for epic-ready-for-dev tasks", () => {
    const task = createTaskCardFixture({
      status: "ready_for_dev",
      issueType: "epic",
      availableActions: ["set_spec", "set_plan", "build_start"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("build_start");
  });

  test("uses build_start as primary for task-ready-for-dev tasks", () => {
    const task = createTaskCardFixture({
      status: "ready_for_dev",
      issueType: "task",
      availableActions: ["set_spec", "set_plan", "build_start"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("build_start");
  });

  test("uses open_builder for in-progress tasks when resume is not available", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      issueType: "epic",
      availableActions: ["set_plan", "build_start", "open_builder", "reset_implementation"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("open_builder");
    expect(result.secondaryActions).toContain("reset_implementation");
  });

  test("uses qa_start as primary during ai review when available", () => {
    const task = createTaskCardFixture({
      status: "ai_review",
      issueType: "epic",
      availableActions: [
        "open_builder",
        "qa_start",
        "human_request_changes",
        "human_approve",
        "reset_implementation",
      ],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("qa_start");
    expect(result.secondaryActions).toEqual([
      "human_approve",
      "human_request_changes",
      "open_builder",
      "reset_implementation",
    ]);
  });

  test("uses build_start as primary for qa rejected in-progress tasks", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      issueType: "task",
      availableActions: ["open_builder", "open_qa", "build_start"],
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: true, updatedAt: "2026-03-09T10:00:00.000Z", verdict: "rejected" },
      },
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("build_start");
    expect(result.secondaryActions).toEqual(["open_builder", "open_qa"]);
  });

  test("uses human_approve as primary during human review", () => {
    const task = createTaskCardFixture({
      status: "human_review",
      issueType: "epic",
      availableActions: [
        "open_builder",
        "qa_start",
        "human_request_changes",
        "human_approve",
        "reset_implementation",
      ],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("human_approve");
    expect(result.secondaryActions).toContain("qa_start");
    expect(result.secondaryActions).toContain("reset_implementation");
  });

  test("filters build_start from human review actions", () => {
    const task = createTaskCardFixture({
      status: "human_review",
      issueType: "feature",
      availableActions: ["human_approve", "human_request_changes", "open_builder", "build_start"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.allActions).toEqual(["human_approve", "human_request_changes", "open_builder"]);
    expect(result.secondaryActions).not.toContain("build_start");
  });

  test("uses resume as primary for deferred tasks", () => {
    const task = createTaskCardFixture({
      status: "deferred",
      issueType: "epic",
      availableActions: ["set_plan", "build_start", "resume_deferred", "defer_issue"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("resume_deferred");
  });

  test("uses active session role as primary and hides session-creating actions", () => {
    const task = createTaskCardFixture({
      status: "in_progress",
      issueType: "task",
      availableActions: [
        "build_start",
        "set_spec",
        "set_plan",
        "qa_start",
        "open_builder",
        "open_qa",
      ],
    });

    const result = resolveTaskCardActions(task, {
      hasActiveSession: true,
      activeSessionRole: "planner",
      historicalSessionRoles: ["spec", "qa"],
    });

    expect(result.primaryAction).toBe("open_planner");
    expect(result.allActions).not.toContain("build_start");
    expect(result.allActions).not.toContain("set_spec");
    expect(result.allActions).not.toContain("set_plan");
    expect(result.allActions).not.toContain("qa_start");
    expect(result.secondaryActions).toEqual(
      expect.arrayContaining(["open_spec", "open_qa", "open_builder"]),
    );
  });

  test("adds historical role view actions as secondary when there is no active session", () => {
    const task = createTaskCardFixture({
      status: "ready_for_dev",
      issueType: "feature",
      availableActions: ["build_start", "qa_start"],
    });

    const result = resolveTaskCardActions(task, {
      historicalSessionRoles: ["spec", "planner"],
    });

    expect(result.primaryAction).toBe("build_start");
    expect(result.secondaryActions).toEqual(
      expect.arrayContaining(["open_spec", "open_planner", "qa_start"]),
    );
  });
});

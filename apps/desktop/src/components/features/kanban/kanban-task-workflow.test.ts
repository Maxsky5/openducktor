import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "@/pages/agent-studio-test-utils";
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
      availableActions: ["set_plan", "build_start", "open_builder"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("open_builder");
  });

  test("uses human_approve as primary during human review", () => {
    const task = createTaskCardFixture({
      status: "human_review",
      issueType: "epic",
      availableActions: ["open_builder", "human_request_changes", "human_approve"],
    });

    const result = resolveTaskCardActions(task);

    expect(result.primaryAction).toBe("human_approve");
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
});

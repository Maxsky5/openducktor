import { expect, test } from "bun:test";
import { specPlanBuildWorkflow } from "@openducktor/workflows";
import { reviewTaskRoles } from "@openducktor/workflows/test-support";
import { reviewVersionDocument } from "../../test-support/workflow-library-fixtures";
import {
  BUILTIN_TASK_ASSIGNMENT,
  assignmentOf,
  compileWorkflowVersion,
  createTaskWorkflowVersionCache,
} from "./task-workflows";

const roles = new Map(reviewTaskRoles.map((role) => [role.id, { role, updatedAtMs: 5 }]));
const storedReview = (version: number, publishedAtMs = 10) => ({
  workflowId: "review",
  version,
  publishedAtMs,
  document: reviewVersionDocument(version),
});
const review = (version: number, publishedAtMs = 10) =>
  compileWorkflowVersion(storedReview(version, publishedAtMs), roles);

test("resolves a task without a version to the built-in workflow", () => {
  const cache = createTaskWorkflowVersionCache();
  expect(cache.forTask(BUILTIN_TASK_ASSIGNMENT)).toBe(specPlanBuildWorkflow);
  expect(cache.forReference(specPlanBuildWorkflow.reference)).toBe(specPlanBuildWorkflow);
  expect(assignmentOf(specPlanBuildWorkflow)).toEqual(BUILTIN_TASK_ASSIGNMENT);
  expect(() => cache.forTask({ workflowId: "review", workflowVersion: null })).toThrow(
    'A task of workflow "review" has no version.',
  );
});

test("resolves exact cached versions and names the version of a miss", () => {
  const cache = createTaskWorkflowVersionCache();
  const tasks = [
    { id: "a", workflowId: "review", workflowVersion: 1, workflowPublishedAtMs: 10 },
    { id: "b", workflowId: "review", workflowVersion: 2, workflowPublishedAtMs: 10 },
    { id: "c", workflowId: "review", workflowVersion: 1, workflowPublishedAtMs: 10 },
    { id: "d", ...BUILTIN_TASK_ASSIGNMENT, workflowPublishedAtMs: null },
  ];
  expect(cache.missing(tasks)).toEqual([
    { workflowId: "review", version: 1 },
    { workflowId: "review", version: 2 },
  ]);
  expect(() => cache.forTask(tasks[0]!)).toThrow('Workflow "review" version 1 is not loaded');
  cache.put({ workflowId: "review", version: 1 }, review(1));
  cache.put({ workflowId: "review", version: 2 }, review(2));
  expect(cache.missing(tasks)).toEqual([]);
  expect(cache.forTask(tasks[1]!).reference).toEqual({ id: "review", revision: 2 });
  expect(cache.forReference({ id: "review", revision: 1 }).reference.revision).toBe(1);
  expect(assignmentOf(cache.forTask(tasks[1]!))).toEqual({
    workflowId: "review",
    workflowVersion: 2,
  });
});

test("treats an entry of another stored version as missing and drops a deleted workflow", () => {
  const cache = createTaskWorkflowVersionCache();
  cache.put({ workflowId: "review", version: 1 }, review(1, 10));
  const assignment = { workflowId: "review", workflowVersion: 1 };
  expect(cache.missing([{ ...assignment, workflowPublishedAtMs: 10 }])).toEqual([]);
  // A workflow that is deleted and created again publishes version 1 at another time.
  expect(cache.missing([{ ...assignment, workflowPublishedAtMs: 20 }])).toEqual([
    { workflowId: "review", version: 1 },
  ]);
  expect(cache.missing([{ ...assignment, workflowPublishedAtMs: null }])).toEqual([
    { workflowId: "review", version: 1 },
  ]);
  cache.dropWorkflow("other");
  expect(cache.cached({ workflowId: "review", version: 1 })).toBeDefined();
  cache.dropWorkflow("review");
  expect(cache.cached({ workflowId: "review", version: 1 })).toBeUndefined();
});

test("keeps the role stamps of a compiled version and drops the versions of a changed role", () => {
  const cache = createTaskWorkflowVersionCache();
  const entry = review(1);
  expect([...entry.roleStamps]).toEqual([
    ["writer", 5],
    ["editor", 5],
  ]);
  cache.put({ workflowId: "review", version: 1 }, entry);
  cache.dropRole("build");
  expect(cache.cached({ workflowId: "review", version: 1 })).toBe(entry);
  cache.dropRole("editor");
  expect(cache.cached({ workflowId: "review", version: 1 })).toBeUndefined();
});

test("remembers the assignment of each task that a read returned, by workspace", () => {
  const cache = createTaskWorkflowVersionCache();
  cache.put({ workflowId: "review", version: 1 }, review(1));
  expect(cache.forTaskId("repo-a", "a")).toBeUndefined();
  cache.noteTasks([{ workspaceId: "repo-a", id: "a", workflowId: "review", workflowVersion: 1 }]);
  expect(cache.forTaskId("repo-a", "a")?.reference).toEqual({ id: "review", revision: 1 });
  // An equal task ID of another workspace is another task.
  expect(cache.forTaskId("repo-b", "a")).toBeUndefined();
  cache.noteTasks([{ workspaceId: "repo-b", id: "a", ...BUILTIN_TASK_ASSIGNMENT }]);
  expect(cache.forTaskId("repo-a", "a")?.reference).toEqual({ id: "review", revision: 1 });
  expect(cache.forTaskId("repo-b", "a")).toBe(specPlanBuildWorkflow);
});

test("names the workflow, the version, and the problem of a version that does not compile", () => {
  expect(() => compileWorkflowVersion(storedReview(3), new Map())).toThrow(
    'Workflow "review" version 3 does not compile:',
  );
});

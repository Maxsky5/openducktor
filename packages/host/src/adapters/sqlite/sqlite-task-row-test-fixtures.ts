import type { TaskRow } from "./sqlite-task-store-schema";

const now = (): Date => new Date("2026-06-10T10:00:00.000Z");

export const taskRowFixture = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  agentSessionsJson: "[]",
  createdAt: now(),
  description: null,
  directMergeJson: null,
  id: "task-1",
  issueType: "task",
  labelsJson: "[]",
  parentId: null,
  priority: 2,
  pullRequestJson: null,
  qaRequired: 1,
  status: "open",
  targetBranchJson: null,
  title: "Task",
  updatedAt: now(),
  ...overrides,
});

export const taskRowRecordFixture = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...taskRowFixture(),
  ...overrides,
});

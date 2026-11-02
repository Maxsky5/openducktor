import type { TaskRow } from "./sqlite-host-database-schema";

export const taskRowFixture = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  workspaceId: "fairnest",
  id: "task-1",
  title: "Task",
  description: null,
  status: "open",
  issueType: "task",
  priority: 2,
  targetBranch: null,
  targetRemote: null,
  removeWorktreeOnClose: null,
  createdAt: new Date("2026-06-10T10:00:00.000Z"),
  updatedAt: new Date("2026-06-10T10:00:00.000Z"),
  ...overrides,
});

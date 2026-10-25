import type { IssueType } from "@openducktor/contracts";

export const ISSUE_TYPE_LABELS = {
  bug: "Bug",
  feature: "Feature",
  epic: "Epic",
  task: "Task",
} satisfies Record<IssueType, string>;

/** The task priorities, from P0 to P4. */
export const PRIORITY_LEVELS = [0, 1, 2, 3, 4] as const;

export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

/** The one label table of the priorities. Its words match the MCP task tools. */
export const PRIORITY_LABELS = {
  0: { label: "P0", hint: "Critical" },
  1: { label: "P1", hint: "High" },
  2: { label: "P2", hint: "Normal" },
  3: { label: "P3", hint: "Low" },
  4: { label: "P4", hint: "Very low" },
} satisfies Record<PriorityLevel, { label: string; hint: string }>;

/** A priority outside the known levels shows as the nearest level, and an invalid one as P4. */
export const toPriorityLevel = (priority: number): PriorityLevel => {
  if (!Number.isFinite(priority)) {
    return 4;
  }
  if (priority <= 0) {
    return 0;
  }
  if (priority >= 4) {
    return 4;
  }
  if (priority === 1 || priority === 2 || priority === 3) {
    return priority;
  }
  return 4;
};

export const getPriorityLabel = (priority: number): (typeof PRIORITY_LABELS)[PriorityLevel] =>
  PRIORITY_LABELS[toPriorityLevel(priority)];

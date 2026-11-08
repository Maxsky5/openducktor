import type { IssueType } from "@openducktor/contracts";
import { type WorkflowRoleId, workflowRoleIcon } from "@openducktor/workflows";
import { type LucideIcon, UserCheck } from "lucide-react";
import { roleIconForHint } from "@/lib/agent-role-presentation";
import { sampleTaskCard } from "./feature-tour-samples";

// The layout and the steps of the workflow diagram of the tour. All sizes are app pixels of the
// stage.

export const PADDING = 18;
export const TYPE_X = 20;
export const TYPE_WIDTH = 96;
const STEP_X = 152;
export const STEP_WIDTH = 124;
export const STEP_HEIGHT = 100;
const STEP_PITCH = 150;
/** The room over the steps for the arrow that skips the optional steps. */
export const SKIP_ROOM = 44;
/** The space between an arrow end and the card that it leaves or enters. */
export const ARROW_GAP = 4;

export const stepX = (index: number): number => STEP_X + index * STEP_PITCH;

export type DiagramStep = { label: string; job: string; icon: LucideIcon; optional: boolean };

/** What each role of the built-in workflow does, in the words of the diagram. */
const ROLE_JOBS = new Map<WorkflowRoleId, string>([
  ["spec", "Writes the spec"],
  ["planner", "Writes the plan"],
  ["build", "Writes the code"],
  ["qa", "Checks the code"],
]);

const roleJob = (roleId: WorkflowRoleId): string => {
  const job = ROLE_JOBS.get(roleId);
  if (!job) throw new Error(`The tour has no job text for the workflow role "${roleId}".`);
  return job;
};

export const HUMAN_REVIEW = { label: "Human Review", job: "You approve it", icon: UserCheck };

/** The agent steps of a new task of `issueType`, as the built-in workflow projects them. */
const newTaskSteps = (issueType: IssueType) => {
  const task = sampleTaskCard({ id: "tour", title: "", issueType, status: "open" });
  return task.workflowSteps.flatMap((step) =>
    step.kind === "agent"
      ? [{ ...step, icon: workflowRoleIcon(task.taskWorkflow, step.roleId) }]
      : [],
  );
};

/**
 * The agent steps of the built-in workflow. A step is optional when a new task of each of
 * `issueTypes` can skip it.
 */
export const workflowSteps = (issueTypes: readonly IssueType[]): DiagramStep[] => {
  const stepsByType = issueTypes.map(newTaskSteps);
  const [steps] = stepsByType;
  if (!steps) throw new Error("A workflow diagram needs at least one issue type.");
  return steps.map((step) => ({
    label: step.label,
    job: roleJob(step.roleId),
    icon: roleIconForHint(step.icon),
    optional: stepsByType.every((typeSteps) =>
      typeSteps.some((other) => other.id === step.id && !other.required),
    ),
  }));
};

/** The number of optional steps at the start of the workflow, which the skip arrow passes. */
export const skippedCount = (steps: readonly DiagramStep[]): number => {
  const firstRequired = steps.findIndex((step) => !step.optional);
  return firstRequired === -1 ? steps.length : firstRequired;
};

/** The height of the diagram of `issueTypes`, in app pixels. */
export const workflowDiagramHeight = (issueTypes: readonly IssueType[]): number =>
  PADDING * 2 + STEP_HEIGHT + (skippedCount(workflowSteps(issueTypes)) > 0 ? SKIP_ROOM : 0);

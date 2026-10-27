import type { TaskWorkflow } from "@openducktor/workflows";
import { createReviewTaskWorkflow } from "@openducktor/workflows/test-support";
import { builtinTaskWorkflowResolver } from "../composition/node/task-workflow-composition";
import type { TaskWorkflowResolver } from "../ports/task-workflow-port";

/** Every task follows the built-in task workflow. */
export const builtinTaskWorkflows = builtinTaskWorkflowResolver;

/** Every task follows the workflow. */
export const singleTaskWorkflow = (workflow: TaskWorkflow): TaskWorkflowResolver => ({
  forTask: () => workflow,
  forNewTask: () => workflow,
  workflows: [workflow],
});

/** Every task follows the review task workflow of the tests. Its IDs differ from the built-in IDs. */
export const reviewTaskWorkflows = singleTaskWorkflow(createReviewTaskWorkflow());

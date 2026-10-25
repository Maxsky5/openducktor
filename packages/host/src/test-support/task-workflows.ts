import { createReviewTaskWorkflow } from "@openducktor/workflows/test-support";
import { builtinTaskWorkflowResolver } from "../composition/node/task-workflow-composition";
import type { TaskWorkflowResolver } from "../ports/task-workflow-port";

/** Every repository follows the built-in task workflow. */
export const builtinTaskWorkflows = builtinTaskWorkflowResolver;

const reviewTaskWorkflow = createReviewTaskWorkflow();

/** Every repository follows the review task workflow of the tests. Its IDs differ from the built-in IDs. */
export const reviewTaskWorkflows: TaskWorkflowResolver = {
  forRepo: () => reviewTaskWorkflow,
  workflows: [reviewTaskWorkflow],
};

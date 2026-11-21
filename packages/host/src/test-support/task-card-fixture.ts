import { taskRecordDataSchema, type TaskCard } from "@openducktor/contracts";
import { specPlanBuildWorkflow, type TaskWorkflow } from "@openducktor/workflows";
import type { z } from "zod";
import { assignmentOf } from "../application/tasks/task-workflows";
import type { TaskWorkflowAssignment } from "../ports/task-workflow-port";

const taskRecordSchema = taskRecordDataSchema;

/**
 * A task card with the workflow projection of its stored fields. It also carries the stored
 * workflow assignment, so it serves as a task record of the store.
 */
export const taskCardFixture = (
  input: z.input<typeof taskRecordSchema>,
  workflow: TaskWorkflow = specPlanBuildWorkflow,
): TaskCard & TaskWorkflowAssignment => {
  const record = taskRecordSchema.parse(input);
  return { ...record, ...workflow.project(record), ...assignmentOf(workflow) };
};

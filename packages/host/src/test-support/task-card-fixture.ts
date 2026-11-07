import { taskRecordDataSchema, type TaskCard } from "@openducktor/contracts";
import { specPlanBuildWorkflow, type TaskWorkflow } from "@openducktor/workflows";
import type { z } from "zod";

const taskRecordSchema = taskRecordDataSchema;

/** A task card with the workflow projection of its stored fields. */
export const taskCardFixture = (
  input: z.input<typeof taskRecordSchema>,
  workflow: TaskWorkflow = specPlanBuildWorkflow,
): TaskCard => {
  const record = taskRecordSchema.parse(input);
  return { ...record, ...workflow.project(record) };
};

import { taskCardSchema, type TaskCard } from "@openducktor/contracts";
import { builtinTaskWorkflow, type TaskWorkflow } from "@openducktor/workflows";
import type { z } from "zod";

const taskRecordSchema = taskCardSchema.omit({ availableActions: true, agentWorkflows: true });

/** A task card with the workflow projection of its stored fields. */
export const taskCardFixture = (
  input: z.input<typeof taskRecordSchema>,
  workflow: TaskWorkflow = builtinTaskWorkflow,
): TaskCard => {
  const record = taskRecordSchema.parse(input);
  return { ...record, ...workflow.project(record) };
};

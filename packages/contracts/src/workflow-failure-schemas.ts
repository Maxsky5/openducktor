import { z } from "zod";

const text = z.string().min(1);
export const workflowFailureSchema = z.strictObject({
  stage: text,
  code: text,
  message: text,
  nextAction: text,
});
export type WorkflowFailure = z.infer<typeof workflowFailureSchema>;

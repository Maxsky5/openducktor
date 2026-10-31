import { z } from "zod";

export const startupOperationContextSchema = z.strictObject({
  startupAttemptId: z.string().min(1),
  operationId: z.string().min(1),
});
export type StartupOperationContext = z.infer<typeof startupOperationContextSchema>;

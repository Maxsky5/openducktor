import { z } from "zod";

export const sessionHistoryFailureSchema = z
  .object({
    code: z.enum(["invalid_runtime_response", "request_failed"]),
    summary: z.string().min(1),
    detail: z.string().min(1),
    diagnosticId: z.string().min(1).optional(),
    method: z.string().min(1).optional(),
    pageCursor: z.string().min(1).nullable().optional(),
  })
  .strict();

export type SessionHistoryFailure = z.infer<typeof sessionHistoryFailureSchema>;

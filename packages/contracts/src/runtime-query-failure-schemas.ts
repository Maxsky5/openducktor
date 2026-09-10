import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { sessionHistoryFailureSchema } from "./session-history-failure-schemas";

export const runtimeQueryFailureSchema = z
  .object({
    code: z.enum([
      "invalid_input",
      "runtime_unavailable",
      "scope_mismatch",
      "unsupported_operation",
      "request_failed",
      "invalid_runtime_response",
    ]),
    operation: z.string().min(1),
    repoPath: z.string().optional(),
    runtimeKind: runtimeKindSchema.optional(),
    workingDirectory: z.string().optional(),
    externalSessionId: z.string().optional(),
    summary: z.string().min(1),
    detail: z.string().min(1),
    sessionHistoryFailure: sessionHistoryFailureSchema.optional(),
  })
  .strict();
export type RuntimeQueryFailure = z.infer<typeof runtimeQueryFailureSchema>;

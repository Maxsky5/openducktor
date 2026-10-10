import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";

export const openCodeMigrationObservationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("required") }),
  z.strictObject({ status: z.literal("completed") }),
  z.strictObject({
    status: z.literal("running"),
    progress: z.strictObject({
      label: z.string(),
      numerator: z.number().nonnegative().optional(),
      denominator: z.number().nonnegative().optional(),
    }),
  }),
  z.strictObject({ status: z.literal("error"), error: z.string() }),
]);
export type OpenCodeMigrationObservation = z.infer<typeof openCodeMigrationObservationSchema>;

export const runtimeOperationFailureSchema = z.strictObject({
  runtimeKind: runtimeKindSchema,
  operation: z.string().min(1),
  repoPath: z.string().min(1),
  workingDirectory: z.string().optional(),
  externalSessionId: z.string().optional(),
  code: z.enum([
    "runtime_unavailable",
    "unsupported_operation",
    "migration_blocked",
    "session_not_found",
    "identity_mismatch",
    "policy_failed",
    "invalid_runtime_response",
    "request_failed",
  ]),
  summary: z.string().min(1),
  nativeReason: z.string().optional(),
  nextAction: z.string().min(1),
  migration: openCodeMigrationObservationSchema.optional(),
});
export type RuntimeOperationFailure = z.infer<typeof runtimeOperationFailureSchema>;

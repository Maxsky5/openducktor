import { z } from "zod";

export const failureKindSchema = z.enum(["timeout", "error"]);

export type FailureKind = z.infer<typeof failureKindSchema>;

export const runtimeEnsureFailureSourceSchema = z.object({
  cause: z.unknown().optional(),
  error: z.string().trim().min(1).optional(),
  failureKind: failureKindSchema.optional(),
  message: z.string().trim().min(1).optional(),
});

export type RuntimeEnsureFailureSource = z.infer<typeof runtimeEnsureFailureSourceSchema>;

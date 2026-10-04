import { z } from "zod";

export const failureKindSchema = z.enum(["timeout", "error"]);

export type FailureKind = z.infer<typeof failureKindSchema>;

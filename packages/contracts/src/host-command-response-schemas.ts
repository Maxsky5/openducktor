import { z } from "zod";
import { hostInvokeFailureSchema } from "./host-invoke-failure-schemas";
import { jsonValueSchema } from "./json-types";

export const hostCommandAcknowledgementResponseSchema = z.object({ ok: z.boolean() }).strict();

export const hostCommandBooleanResponseSchema = z.boolean();

export const hostCommandEmptyResponseSchema = z
  .union([z.null(), z.undefined()])
  .transform(() => null);

export const hostCommandNonEmptyStringResponseSchema = z.string().trim().min(1);

export const localAttachmentPathResponseSchema = z
  .object({ path: z.string().trim().min(1) })
  .strict();

export const hostErrorResponseSchema = z
  .object({
    error: z.string().trim().min(1).optional(),
    failure: hostInvokeFailureSchema.optional(),
    failureKind: z.string().trim().min(1).optional(),
    message: z.string().trim().min(1).optional(),
  })
  .catchall(jsonValueSchema);

export type HostErrorResponse = z.infer<typeof hostErrorResponseSchema>;

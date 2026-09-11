import { z } from "zod";

/**
 * Retains the UTF-16 length limit used before Zod 4.5.
 * Validate inputs with Zod to enforce this rule. Generated JSON Schema exposes only
 * the code-point maxLength bound and cannot express the stricter UTF-16 refinement.
 */
export const withMaxUtf16Length = (schema: z.ZodString, maximum: number): z.ZodString =>
  schema.max(maximum).superRefine((value, context) => {
    if (value.length > maximum && !context.issues.some((issue) => issue.code === "too_big")) {
      context.addIssue({ code: "too_big", origin: "string", maximum, inclusive: true });
    }
  });

// Existing runtime timestamps can omit seconds.
export const isoTimestampSchema = z.compile(
  z.union([
    z.string().datetime({ offset: true }),
    z.string().datetime({ offset: true, precision: -1 }),
  ]),
  { strict: true },
);

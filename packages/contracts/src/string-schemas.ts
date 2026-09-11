import { z } from "zod";

// Zod 4.5 counts code points. These limits retain their existing UTF-16 length rule.
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

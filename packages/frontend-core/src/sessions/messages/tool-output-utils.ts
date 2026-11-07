import type { ZodType } from "zod";

/** The result of a tool call that its output holds as JSON, or null when it does not match. */
export const parseToolOutput = <Result>(
  schema: ZodType<Result>,
  output: string | undefined,
): Result | null => {
  if (!output) return null;
  try {
    const result = schema.safeParse(JSON.parse(output));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

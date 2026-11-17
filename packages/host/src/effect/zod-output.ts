import { Effect } from "effect";
import type { z } from "zod";
import { errorMessage, HostValidationError } from "./host-errors";

export const parseAdapterOutput = <Schema extends z.ZodType, Input>(
  schema: Schema,
  value: Input,
  operation: string,
): Effect.Effect<z.output<Schema>, HostValidationError<{ operation: string }>> =>
  Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      new HostValidationError({
        message: errorMessage(cause),
        cause,
        details: { operation },
      }),
  });

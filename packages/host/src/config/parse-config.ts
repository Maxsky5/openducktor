import { Effect } from "effect";
import type { z } from "zod";
import type { HostValidationError } from "../effect/host-errors";
import { configValidationError, type PayloadValue } from "./config-validation-message";

export const parseConfig = <Output>(
  schema: z.ZodType<Output>,
  payload: PayloadValue,
): Effect.Effect<Output, HostValidationError> =>
  Effect.try({
    try: () => schema.parse(payload),
    catch: (cause) => configValidationError(cause, payload),
  });

import { z } from "zod";
import { NON_ERROR_THROWN_PREFIX } from "@/types/constants";

const thrownStringSchema = z.string();

export const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }

  const parsedCause = thrownStringSchema.safeParse(cause);
  if (parsedCause.success) {
    return parsedCause.data;
  }

  const fallbackMessage = `${NON_ERROR_THROWN_PREFIX} ${String(cause)}`;

  try {
    const serialized = JSON.stringify(cause);
    return serialized ?? fallbackMessage;
  } catch {
    return fallbackMessage;
  }
};

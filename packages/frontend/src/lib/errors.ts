import { NON_ERROR_THROWN_PREFIX } from "@/types/constants";

export const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "string") {
    return cause;
  }

  const fallbackMessage = `${NON_ERROR_THROWN_PREFIX} ${String(cause)}`;

  try {
    const serialized = JSON.stringify(cause);
    return typeof serialized === "string" ? serialized : fallbackMessage;
  } catch {
    return fallbackMessage;
  }
};

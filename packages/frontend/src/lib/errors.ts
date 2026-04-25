import { NON_ERROR_THROWN_PREFIX } from "@/types/constants";

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  const fallbackMessage = `${NON_ERROR_THROWN_PREFIX} ${String(error)}`;

  try {
    const serialized = JSON.stringify(error);
    return typeof serialized === "string" ? serialized : fallbackMessage;
  } catch {
    return fallbackMessage;
  }
};

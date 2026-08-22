import { hasRuntimeType } from "@openducktor/contracts";
export const unwrapData = <T>(
  payload: { data?: T; error?: { message?: string } | unknown },
  action: string,
): NonNullable<T> => {
  if (payload.data !== undefined && payload.data !== null) {
    // SAFETY: The preceding runtime guard establishes `NonNullable<T>` before this assertion.
    return payload.data as NonNullable<T>;
  }

  // SAFETY: The preceding runtime guard establishes the asserted shape before this assertion.
  const errorMessage =
    hasRuntimeType(payload.error, "object") &&
    payload.error !== null &&
    "message" in payload.error &&
    hasRuntimeType((payload.error as { message?: unknown }).message, "string")
      ? (payload.error as { message: string }).message
      : `OpenCode request failed: ${action}`;
  throw new Error(errorMessage);
};

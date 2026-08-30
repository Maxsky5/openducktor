import { errorMessage } from "@/lib/errors";

export const errorMessageFromUnknown = (cause: unknown, fallback: string): string => {
  const message = errorMessage(cause);
  if (message.trim()) {
    return message;
  }
  return fallback;
};

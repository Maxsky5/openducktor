import { errorMessage } from "@/lib/errors";

export const errorMessageFromUnknown = (error: unknown, fallback: string): string => {
  const message = errorMessage(error);
  if (message.trim()) {
    return message;
  }
  return fallback;
};

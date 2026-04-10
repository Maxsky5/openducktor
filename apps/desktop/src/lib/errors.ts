import { NON_ERROR_THROWN_PREFIX } from "@/types/constants";

const ERROR_TOAST_SHOWN = Symbol("errorToastShown");

type ToastTrackedError = Error & {
  [ERROR_TOAST_SHOWN]?: boolean;
};

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

export const markErrorToastShown = <T>(error: T): T => {
  if (error instanceof Error) {
    (error as ToastTrackedError)[ERROR_TOAST_SHOWN] = true;
  }

  return error;
};

export const hasErrorToastShown = (error: unknown): boolean => {
  return error instanceof Error && (error as ToastTrackedError)[ERROR_TOAST_SHOWN] === true;
};

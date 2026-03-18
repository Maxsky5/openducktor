export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  const fallbackMessage = `Non-Error thrown: ${String(error)}`;

  try {
    const serialized = JSON.stringify(error);
    return typeof serialized === "string" ? serialized : fallbackMessage;
  } catch {
    return fallbackMessage;
  }
};

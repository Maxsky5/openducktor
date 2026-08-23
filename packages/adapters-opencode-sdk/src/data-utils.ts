import { z } from "zod";

const opencodeErrorSchema = z.object({ message: z.string() });

export const unwrapData = <T>(
  payload: { data?: T | null | undefined; error?: { message?: string } | unknown },
  action: string,
): T => {
  if (payload.data !== undefined && payload.data !== null) {
    return payload.data;
  }

  const parsedError = opencodeErrorSchema.safeParse(payload.error);
  const errorMessage = parsedError.success
    ? parsedError.data.message
    : `OpenCode request failed: ${action}`;
  throw new Error(errorMessage);
};

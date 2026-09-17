import { z } from "zod";
import { OpenCodeRequestError } from "./request-errors";

const opencodeErrorSchema = z.object({ message: z.string() });

type ResponseMetadata = {
  status?: number;
  statusText?: string;
};

export const unwrapData = <T>(
  payload: { data?: T | null; error?: unknown; response?: ResponseMetadata },
  action: string,
): NonNullable<T> => {
  if (payload.data !== undefined && payload.data !== null) {
    return payload.data;
  }

  const parsedError = opencodeErrorSchema.safeParse(payload.error);
  const errorMessage = parsedError.success
    ? parsedError.data.message
    : `OpenCode request failed: ${action}`;
  if (payload.response?.status === 404) {
    const failure: ConstructorParameters<typeof OpenCodeRequestError>[1] = {
      failureKind: "error",
      status: 404,
    };
    if (payload.response.statusText !== undefined) {
      failure.statusText = payload.response.statusText;
    }
    throw new OpenCodeRequestError(errorMessage, failure);
  }
  throw new Error(errorMessage);
};

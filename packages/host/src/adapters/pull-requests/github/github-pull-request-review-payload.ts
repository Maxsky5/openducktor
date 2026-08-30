import { z } from "zod";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";

const zodIssueField = (cause: z.ZodError, fieldPrefix?: string): string => {
  const path = cause.issues[0]?.path;
  const parts = [...(fieldPrefix ? [fieldPrefix] : []), ...(path ?? [])];
  return parts.length > 0 ? parts.join(".") : "payload";
};

export const parseGithubJson = <Schema extends z.ZodType>(
  payload: string,
  responseLabel: string,
  schema: Schema,
  fieldPrefix?: string,
): z.output<Schema> => {
  try {
    return schema.parse(JSON.parse(payload));
  } catch (cause) {
    throw new HostValidationError({
      field: cause instanceof z.ZodError ? zodIssueField(cause, fieldPrefix) : "payload",
      message: `Failed to parse GitHub ${responseLabel} response: ${errorMessage(cause)}`,
      cause,
    });
  }
};

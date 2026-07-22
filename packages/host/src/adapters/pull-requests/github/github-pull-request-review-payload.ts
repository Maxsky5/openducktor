import { errorMessage, HostValidationError } from "../../../effect/host-errors";

export type GithubPayloadObject = Record<string, unknown>;

const isGithubPayloadObject = (value: unknown): value is GithubPayloadObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const githubPayloadValueType = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
};

export const parseGithubJson = (payload: string, responseLabel: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch (cause) {
    throw new HostValidationError({
      field: "payload",
      message: `Failed to parse GitHub ${responseLabel} response: ${errorMessage(cause)}`,
      cause,
    });
  }
};

export const requireGithubObject = (value: unknown, field: string): GithubPayloadObject => {
  if (!isGithubPayloadObject(value)) {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}' is missing or invalid.`,
      details: { receivedType: githubPayloadValueType(value) },
    });
  }
  return value;
};

export const parseGithubJsonObject = (
  payload: string,
  responseLabel: string,
): GithubPayloadObject => requireGithubObject(parseGithubJson(payload, responseLabel), "payload");

export const toNullableGithubObject = (
  value: unknown,
  field: string,
): GithubPayloadObject | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return requireGithubObject(value, field);
};

export const toNullableGithubString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

export const requireGithubString = (value: unknown, field: string): string => {
  const parsed = toNullableGithubString(value);
  if (!parsed) {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}' is missing or invalid.`,
    });
  }
  return parsed;
};

export const requireGithubBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}' is missing or invalid.`,
    });
  }
  return value;
};

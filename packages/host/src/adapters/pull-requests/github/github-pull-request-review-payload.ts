import {
  hasRuntimeType,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  jsonValueSchema,
  runtimeTypeName,
} from "@openducktor/contracts";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";

export type GithubPayloadObject = JsonObject;
export type GithubPayloadValue = JsonValue | undefined;

const githubPayloadValueType = (value: GithubPayloadValue): string => {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return runtimeTypeName(value);
};

export const parseGithubJson = (payload: string, responseLabel: string): JsonValue => {
  try {
    return jsonValueSchema.parse(JSON.parse(payload));
  } catch (cause) {
    throw new HostValidationError({
      field: "payload",
      message: `Failed to parse GitHub ${responseLabel} response: ${errorMessage(cause)}`,
      cause,
    });
  }
};

export const requireGithubObject = (
  value: GithubPayloadValue,
  field: string,
): GithubPayloadObject => {
  if (value === undefined || !isJsonObject(value)) {
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
  value: GithubPayloadValue,
  field: string,
): GithubPayloadObject | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return requireGithubObject(value, field);
};

export const toNullableGithubString = (value: GithubPayloadValue): string | null =>
  hasRuntimeType(value, "string") && value.trim().length > 0 ? value : null;

export const requireGithubString = (value: GithubPayloadValue, field: string): string => {
  const parsed = toNullableGithubString(value);
  if (!parsed) {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}' is missing or invalid.`,
    });
  }
  return parsed;
};

export const requireGithubBoolean = (value: GithubPayloadValue, field: string): boolean => {
  if (!hasRuntimeType(value, "boolean")) {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}' is missing or invalid.`,
    });
  }
  return value;
};

export const parseGithubNextPageCursor = (
  pageInfoValue: GithubPayloadValue,
  field: string,
): string | null => {
  const pageInfo = requireGithubObject(pageInfoValue, field);
  return requireGithubBoolean(pageInfo.hasNextPage, `${field}.hasNextPage`)
    ? requireGithubString(pageInfo.endCursor, `${field}.endCursor`)
    : null;
};

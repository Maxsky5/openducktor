import type { AgentToolData } from "@openducktor/contracts";

const isStringValue = (value: AgentToolData[string] | undefined): value is string =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Tool fields have already passed boundary validation.
  typeof value === "string";

export const readInputString = (
  input: AgentToolData | undefined,
  keys: string[],
): string | null => {
  if (!input) {
    return null;
  }
  for (const key of keys) {
    const value = input[key];
    if (isStringValue(value) && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

export const extractPathFromInput = (input: AgentToolData | undefined): string | null => {
  const candidate =
    input?.filePath ?? input?.file_path ?? input?.path ?? input?.file ?? input?.filename;
  if (isStringValue(candidate)) {
    const normalized = candidate.trim();
    if (normalized.length > 0 && normalized !== ".") {
      return normalized;
    }
  }
  return null;
};

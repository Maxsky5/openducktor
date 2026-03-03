export const readInputString = (
  input: Record<string, unknown> | undefined,
  keys: string[],
): string | null => {
  if (!input) {
    return null;
  }
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

export const extractPathFromInput = (input: Record<string, unknown> | undefined): string | null => {
  const candidate =
    input?.filePath ?? input?.file_path ?? input?.path ?? input?.file ?? input?.filename;
  if (typeof candidate === "string") {
    const normalized = candidate.trim();
    if (normalized.length > 0 && normalized !== ".") {
      return normalized;
    }
  }
  return null;
};

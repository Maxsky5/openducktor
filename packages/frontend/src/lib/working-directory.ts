export const normalizeWorkingDirectory = (workingDirectory: string | null | undefined): string => {
  let normalized = workingDirectory?.trim() ?? "";
  if (/^[A-Za-z]:[\\/]$/.test(normalized)) {
    return normalized;
  }
  while (normalized.length > 1 && /[\\/]/.test(normalized.at(-1) ?? "")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

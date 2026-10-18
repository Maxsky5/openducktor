import { trimTrailingPathSeparators } from "@openducktor/path-support";

export const normalizeWorkingDirectory = (workingDirectory: string | null | undefined): string => {
  return trimTrailingPathSeparators(workingDirectory?.trim() ?? "");
};

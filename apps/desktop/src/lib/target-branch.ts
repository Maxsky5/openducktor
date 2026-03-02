export const DEFAULT_TARGET_BRANCH = "origin/main";

export const normalizeCanonicalTargetBranch = (value: string | null | undefined): string => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return DEFAULT_TARGET_BRANCH;
  }
  if (trimmed.includes("/")) {
    return trimmed;
  }
  return `origin/${trimmed}`;
};

export type ResolveUserPathOptions = {
  homeDir?: string;
  resolveHomeDir?: () => string;
  joinHomePath?: (homeDir: string, relativePath: string) => string;
};

const stripMatchingQuotes = (value: string): string =>
  value.length >= 2 &&
  ((value.at(0) === `"` && value.at(-1) === `"`) || (value.at(0) === `'` && value.at(-1) === `'`))
    ? value.slice(1, -1)
    : value;

export const normalizeUserPathInput = (rawPath: string): string =>
  stripMatchingQuotes(rawPath.trim()).trim();

const homeRelativePath = (normalizedPath: string): string | null => {
  if (normalizedPath.startsWith("~/") || normalizedPath.startsWith("~\\")) {
    return normalizedPath.slice(2);
  }
  return null;
};

export const resolveNormalizedUserPath = (
  normalizedPath: string,
  { homeDir, joinHomePath, resolveHomeDir }: ResolveUserPathOptions = {},
): string => {
  const resolvedHomeDir = (): string => {
    const resolved = homeDir ?? resolveHomeDir?.();
    if (resolved) {
      return resolved;
    }
    throw new Error("Home directory is required to resolve a home-relative path.");
  };

  if (normalizedPath === "~") {
    return resolvedHomeDir();
  }

  const relativePath = homeRelativePath(normalizedPath);
  if (relativePath !== null) {
    const nextHomeDir = resolvedHomeDir();
    if (!joinHomePath) {
      throw new Error("Path joining is required to resolve a home-relative path.");
    }
    return joinHomePath(nextHomeDir, relativePath);
  }

  return normalizedPath;
};

export const resolveUserPath = (rawPath: string, options: ResolveUserPathOptions = {}): string =>
  resolveNormalizedUserPath(normalizeUserPathInput(rawPath), options);

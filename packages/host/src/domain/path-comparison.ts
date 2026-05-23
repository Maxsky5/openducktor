const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:(?:[\\/]|$)/;

export const normalizePathForComparison = (value: string): string => {
  const trimmed = value.trim();
  const leadingSeparatorRoot = /^[\\/]/.test(trimmed);
  const windowsDrivePath = WINDOWS_DRIVE_PATH_PATTERN.test(trimmed);
  const segments: string[] = [];
  for (const segment of trimmed.split(/[\\/]+/)) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const comparable = leadingSeparatorRoot ? `/${segments.join("/")}` : segments.join("/");
  return windowsDrivePath ? comparable.toLowerCase() : comparable;
};

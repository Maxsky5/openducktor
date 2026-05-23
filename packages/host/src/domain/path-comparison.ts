export const normalizePathForComparison = (value: string): string => {
  const trimmed = value.trim();
  const absolute = /^[\\/]/.test(trimmed);
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
  return absolute ? `/${segments.join("/")}` : segments.join("/");
};

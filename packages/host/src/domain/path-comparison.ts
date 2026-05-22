export const normalizePathForComparison = (value: string): string => {
  const normalized = value.trim().replace(/\\/g, "/");
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return normalized.startsWith("/") ? `/${segments.join("/")}` : segments.join("/");
};

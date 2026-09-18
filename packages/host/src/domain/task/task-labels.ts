export const normalizeLabels = (labels: readonly string[]): string[] =>
  Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))).sort();

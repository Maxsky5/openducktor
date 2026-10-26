export const toDisplayTaskLabels = (labels: string[] | undefined): string[] => labels ?? [];

/** The stored form of a typed label: trimmed, lower case, with dashes for spaces. */
export const normalizeTaskLabel = (label: string): string =>
  label.trim().replace(/\s+/g, "-").toLowerCase();

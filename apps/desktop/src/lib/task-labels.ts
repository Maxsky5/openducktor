export const toDisplayTaskLabels = (labels: string[] | undefined): string[] =>
  (labels ?? []).filter((label) => !label.startsWith("phase:"));

export const lineCountAccessibilityLabel = (additions: number, deletions: number): string =>
  `${additions} ${additions === 1 ? "line" : "lines"} added, ${deletions} removed`;

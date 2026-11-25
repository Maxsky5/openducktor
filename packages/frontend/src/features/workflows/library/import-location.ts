import type { WorkflowImportPreview } from "@openducktor/contracts";

/** Where an invalid file fails, such as " (line 3, column 5)", or nothing without a line. */
export const invalidLocation = (
  preview: Extract<WorkflowImportPreview, { outcome: "invalid" }>,
) => {
  if (preview.line === null) return "";
  return preview.column === null
    ? ` (line ${preview.line})`
    : ` (line ${preview.line}, column ${preview.column})`;
};

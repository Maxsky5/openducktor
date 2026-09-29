// The data of the Diagnostics sheet: the rows and the status of each section.

/** A row of DiagnosticsKeyValueRow in diagnostics-key-value-row.tsx. */
export type DiagRowData = {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
  strong?: boolean;
  breakAll?: boolean;
};

/** The status badge of a section and its body: rows, a loading text, or nothing. */
export type DiagState = {
  badge: string;
  tone: "success" | "warning" | "secondary";
  rows?: readonly DiagRowData[];
  empty?: string;
};

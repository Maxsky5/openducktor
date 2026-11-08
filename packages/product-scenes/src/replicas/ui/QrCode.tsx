// A QR code drawn from its module rows, as the qrcode package renders the pairing QR code of the
// desktop app. Each row is a string of 1 for a dark module and 0 for a light one. The code has a
// quiet zone of 2 modules, as pairing-panel.tsx asks for.
import type { ReactElement } from "react";
import { classes } from "../classes";
import "./QrCode.css";

const QUIET = 2;

/** One path of the dark modules: a rectangle for each run of dark modules in a row. */
function modulePath(rows: readonly string[]): string {
  const parts: string[] = [];
  rows.forEach((row, y) => {
    for (const run of row.matchAll(/1+/g)) {
      parts.push(`M${run.index + QUIET} ${y + QUIET}h${run[0].length}v1h-${run[0].length}z`);
    }
  });
  return parts.join("");
}

export function QrCode({
  rows,
  className,
}: {
  rows: readonly string[];
  className?: string;
}): ReactElement {
  const size = rows.length + 2 * QUIET;
  return (
    <svg className={classes("ui-qr", className)} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <rect width={size} height={size} fill="#fff" />
      <path d={modulePath(rows)} fill="#000" />
    </svg>
  );
}

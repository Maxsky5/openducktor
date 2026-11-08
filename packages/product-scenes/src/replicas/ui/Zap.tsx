// The Zap glyph of lucide-react 0.577, which the desktop app uses. lucide-react 1.59 draws Zap with
// another shape, so this copy keeps the path of the app.
import type { ReactElement } from "react";
import { classes } from "../classes";

const PATH =
  "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z";

export function Zap({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={classes("lucide", className)}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATH} />
    </svg>
  );
}

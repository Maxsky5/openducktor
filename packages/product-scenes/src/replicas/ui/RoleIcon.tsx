// The custom role icons of lib/agent-role-presentation.ts, drawn on the lucide 24 pixel grid. The
// workflow rail, the sidebar, the command palette, and the start dialog show them.
import type { ReactElement } from "react";
import { classes } from "../classes";
import type { RoleId } from "../vocabulary";

const PATHS = {
  spec: (
    <>
      <path d="M10 21H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h6l5 5v2" />
      <path d="M8 7h3" />
      <path d="M8 11h2" />
      <circle cx="17" cy="17" r="4" />
      <circle cx="17" cy="17" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  planner: (
    <>
      <path d="M21 8c0 3.5-5 8-5 8s-5-4.5-5-8a5 5 0 0 1 10 0" />
      <circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <path d="M8 18.5h5a3 3 0 0 0 2.6-1.5" />
    </>
  ),
  build: (
    <>
      <path d="M4 14.5a8 8.5 0 0 1 16 0" />
      <path d="M10 6.3V11" />
      <path d="M14 6.3V11" />
      <rect x="2" y="14.5" width="20" height="5" rx="2.5" />
    </>
  ),
  qa: (
    <>
      <circle cx="10.5" cy="10.5" r="7.5" />
      <path d="m21 21-5.2-5.2" />
      <path d="m7.5 10.5 2 2 4-4" />
    </>
  ),
} satisfies Record<RoleId, ReactElement>;

export function RoleIcon({ role, className }: { role: RoleId; className?: string }): ReactElement {
  return (
    <svg
      className={classes("lucide", "role-icon", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[role]}
    </svg>
  );
}

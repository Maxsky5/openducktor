// A badge of a task card in kanban-task-card.tsx: a pill with an icon or a dot, in the colors of
// its tone.
import type { ComponentProps, ReactElement } from "react";
import "./Badge.css";

type BadgeTone = "bug" | "feature" | "p1" | "p2" | "p3" | "rejected" | "pr";

type BadgeProps = ComponentProps<"span"> & {
  /** A badge without a tone has the muted colors, as the Task kind has. */
  tone?: BadgeTone | undefined;
};

export function Badge({ tone, ...attributes }: BadgeProps): ReactElement {
  return <span className="badge" data-tone={tone} {...attributes} />;
}

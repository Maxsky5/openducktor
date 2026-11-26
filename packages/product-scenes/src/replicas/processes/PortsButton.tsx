// The trigger of ports-popover.tsx: one small button with the running dot and the count of the
// ports. The top bar of a task session shows it for the web ports of the task
// (TaskServerPortsMenu of task-server-links.tsx), and a command line of a narrow list shows it in
// place of its ports, with the number only.
import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import { countLabel } from "./model";
import "./PortsButton.css";

type PortsButtonProps = ComponentProps<"span"> & {
  count: number;
  /** Shows only the number, for a line with little space. */
  compact?: boolean;
};

export function PortsButton({
  count,
  compact = false,
  className,
  ...attributes
}: PortsButtonProps): ReactElement {
  return (
    <span className={classes("tp", className)} {...attributes}>
      <i className="run-dot" />
      {compact ? count : countLabel(count, "port", "ports")}
      <ChevronDown />
    </span>
  );
}

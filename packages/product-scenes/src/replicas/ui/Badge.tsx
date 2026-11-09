// Badge of components/ui/badge.tsx, with the variants that the replicas use. A scene can hide a
// badge with `hidden`.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import "./Badge.css";

type BadgeProps = ComponentProps<"span"> & { variant?: "outline" | "success" };

export function Badge({ variant = "outline", className, ...attributes }: BadgeProps): ReactElement {
  return <span className={classes("ui-badge", className)} data-variant={variant} {...attributes} />;
}

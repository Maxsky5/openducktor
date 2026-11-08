// The root of a product replica. It carries the theme tokens of the desktop app and the design
// pixel of the replica. The scene that holds a replica describes it in words, so the replica is
// hidden from assistive technology.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "./classes";
import "../../styles/index.css";

export function Replica({ className, ...attributes }: ComponentProps<"div">): ReactElement {
  return (
    <div
      className={classes("replica", className)}
      aria-hidden="true"
      data-root=""
      {...attributes}
    />
  );
}

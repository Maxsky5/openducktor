// The key caps of components/ui/kbd.tsx: one cap for each key of a shortcut, 2 pixels apart. The
// copied UI shows the macOS keys.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import "./Kbd.css";

type KbdProps = ComponentProps<"span"> & { keys: readonly string[] };

export function Kbd({ keys, className, ...attributes }: KbdProps): ReactElement {
  return (
    <span className={classes("ui-kbd", className)} {...attributes}>
      {keys.map((key, index) => (
        <kbd key={`${index}-${key}`}>{key}</kbd>
      ))}
    </span>
  );
}

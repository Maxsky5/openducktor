// Switch of components/ui/switch.tsx. A checked switch has `data-checked`, and a scene can set it.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import { flag } from "../flag";
import "./Switch.css";

type SwitchProps = ComponentProps<"span"> & { checked?: boolean };

export function Switch({ checked = false, className, ...attributes }: SwitchProps): ReactElement {
  return (
    <span className={classes("ui-switch", className)} data-checked={flag(checked)} {...attributes}>
      <span className="ui-switch-thumb" />
    </span>
  );
}

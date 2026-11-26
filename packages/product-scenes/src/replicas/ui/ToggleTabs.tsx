// ToggleTabs and ToggleTabsItem of components/ui/toggle-tabs.tsx: one choice of a few options with
// the look of a tab list. The checked item has `data-checked`, and a scene moves it.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import { flag } from "../flag";
import "./ToggleTabs.css";

export function ToggleTabs({ className, ...attributes }: ComponentProps<"div">): ReactElement {
  return <div className={classes("ui-toggle-tabs", className)} {...attributes} />;
}

type ToggleTabsItemProps = ComponentProps<"span"> & { checked?: boolean };

export function ToggleTabsItem({
  checked = false,
  className,
  ...attributes
}: ToggleTabsItemProps): ReactElement {
  return (
    <span
      className={classes("ui-toggle-tabs-item", className)}
      data-checked={flag(checked)}
      {...attributes}
    />
  );
}

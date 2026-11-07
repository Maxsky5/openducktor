// The content pane of a settings section, cropped from the Settings dialog of settings-modal.tsx.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import { Replica } from "../Replica";
import "./SettingsPane.css";

export function SettingsPane({ className, ...attributes }: ComponentProps<"div">): ReactElement {
  return <Replica className={classes("set-pane", className)} {...attributes} />;
}

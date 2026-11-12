// Button of components/ui/button.tsx, with the variants and the sizes that the replicas use. A
// consumer changes the height or the radius with its own class, as the product does with
// `className`. A disabled button has `data-disabled`, and a scene can set it.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import "./Button.css";

type ButtonVariant = "default" | "secondary" | "ghost" | "outline" | "destructive" | "accent";

type ButtonProps = ComponentProps<"span"> & {
  variant?: ButtonVariant;
  size?: "default" | "sm" | "xs" | "icon";
};

export function Button({
  variant = "default",
  size = "default",
  className,
  ...attributes
}: ButtonProps): ReactElement {
  return (
    <span
      className={classes("ui-button", className)}
      data-variant={variant}
      data-size={size}
      {...attributes}
    />
  );
}

// Input of components/ui/input.tsx: the field chrome, the text that a scene types, and the
// placeholder. The placeholder shows after the caret while the field is empty. A scene sets
// `data-filled` when it types the first letter, and `data-focused` while the field has the focus.
// The children are the adornments of a field, such as the icon and the clear button of a search,
// which the stylesheet of the field places.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import { flag } from "../flag";
import "./Input.css";

type InputProps = ComponentProps<"span"> & { placeholder: string; value?: string };

export function Input({
  placeholder,
  value = "",
  className,
  children,
  ...attributes
}: InputProps): ReactElement {
  return (
    <span
      className={classes("ui-input", className)}
      data-filled={flag(value !== "")}
      {...attributes}
    >
      <span className="typed" data-typed="">
        {value}
      </span>
      <span className="ui-input-placeholder">{placeholder}</span>
      {children}
    </span>
  );
}

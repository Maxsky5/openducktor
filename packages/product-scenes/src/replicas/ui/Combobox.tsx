// The trigger of components/ui/combobox.tsx and of the model picker: the value, then
// ChevronsUpDown. With `branch`, it is the trigger of BranchSelector in branch-selector.tsx, with
// the branch icon before the value.
import { ChevronsUpDown, GitBranch } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import "./Combobox.css";

type ComboboxProps = ComponentProps<"span"> & { branch?: boolean };

export function Combobox({
  branch = false,
  className,
  children,
  ...attributes
}: ComboboxProps): ReactElement {
  return (
    <span className={classes("ui-combobox", className)} {...attributes}>
      <span className="ui-combobox-value">
        {branch && <GitBranch className="i14 ui-combobox-icon" />}
        {children}
      </span>
      <ChevronsUpDown className="ui-combobox-chevron" />
    </span>
  );
}

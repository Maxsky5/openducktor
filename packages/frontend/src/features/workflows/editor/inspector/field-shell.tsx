import type { WorkflowProblemPath } from "@openducktor/contracts";
import type { ReactElement, ReactNode } from "react";
import { Lock } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fieldPathAttribute, useInspector } from "./inspector-context";

/**
 * The light look of a one-line control in the details: a thin border that darkens on hover, on a
 * clear background, so a column of fields reads as a property list.
 */
export const QUIET_CONTROL_CLASS =
  "h-8 border-border/70 bg-transparent text-[13px] shadow-none hover:border-foreground/25 dark:bg-transparent";

/** The look of every field label, beside or over its control. */
export const FIELD_LABEL_CLASS = "text-[13px] leading-4 font-medium text-muted-foreground";

export type FieldOption<Value extends string = string> = {
  readonly value: Value;
  readonly label: string;
  readonly description?: string;
  /** Text beside the label, such as the element ID. */
  readonly secondaryLabel?: string;
  /** The heading that the option shows under in a picker, such as its step. */
  readonly group?: string;
  /** The mark of the option in a picker, such as the colour dot of a state. */
  readonly icon?: ReactNode;
};

type ShellProps = {
  label: string;
  /** The field path that problems and focus requests use. A group of fields has none. */
  path: WorkflowProblemPath | null;
  labelId: string;
  controlId?: string;
  hint?: ReactNode;
  /** A local reason, such as an invalid ID that the document does not take yet. */
  error?: string | undefined;
  children: ReactNode;
  className?: string;
  /**
   * `row` puts the label beside a one-line control, as in a property panel. `stack` puts it over
   * a control that needs the full width, such as a text area or a set of chips.
   */
  layout?: "row" | "stack";
  /** The value is fixed, such as by the built-in workflow. A lock shows beside the label. */
  locked?: boolean;
};

/** A field with its label, hint, and local error. A problem at its path marks it invalid. */
export function FieldShell({
  label,
  path,
  labelId,
  controlId,
  hint,
  error,
  children,
  className,
  layout = "stack",
  locked = false,
}: ShellProps): ReactElement {
  const { problemPaths } = useInspector();
  const attribute = path === null ? undefined : fieldPathAttribute(path);
  const invalid = error !== undefined || (attribute !== undefined && problemPaths.has(attribute));
  return (
    <div
      data-field-path={attribute}
      data-invalid={invalid || undefined}
      className={cn(
        "min-w-0 rounded-md data-[invalid]:[&_[data-slot=input]]:border-destructive-border data-[invalid]:[&_textarea]:border-destructive-border data-[invalid]:[&>button[data-slot=button]]:border-destructive-border",
        layout === "row"
          ? "grid grid-cols-[var(--field-label-col,7.5rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-1"
          : "flex flex-col gap-1.5",
        className,
      )}
    >
      <Label id={labelId} htmlFor={controlId} className={FIELD_LABEL_CLASS}>
        {label}
        {locked ? (
          <span title="This value is fixed.">
            <Lock aria-hidden="true" className="ml-1.5 inline size-3 align-[-1px]" />
          </span>
        ) : null}
      </Label>
      {children}
      {hint ? (
        <p
          className={cn(
            "text-xs leading-5 text-pretty text-muted-foreground",
            layout === "row" && "col-span-2",
          )}
        >
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          className={cn(
            "text-xs leading-5 text-destructive-muted",
            layout === "row" && "col-span-2",
          )}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

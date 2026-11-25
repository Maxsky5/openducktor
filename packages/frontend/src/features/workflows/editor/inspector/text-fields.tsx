import type { WorkflowProblemPath } from "@openducktor/contracts";
import { type ReactElement, type ReactNode, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FieldShell, QUIET_CONTROL_CLASS } from "./field-shell";

/** A text area with the same light border as the one-line controls. */
const TEXTAREA_CLASS =
  "border-border/70 bg-transparent text-[13px] shadow-none hover:border-foreground/25 dark:bg-transparent";
import { useInspector } from "./inspector-context";

type TextFieldProps = {
  label: string;
  path: WorkflowProblemPath;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  hint?: ReactNode;
  /** Shows a value that the editor cannot change here, such as a built-in state label. */
  fixed?: boolean;
};

export function TextField({
  label,
  path,
  value,
  onChange,
  placeholder,
  multiline = false,
  hint,
  fixed = false,
}: TextFieldProps): ReactElement {
  const { readOnly } = useInspector();
  const id = useId();
  const common = {
    id,
    value,
    placeholder: fixed && value === "" ? "None" : placeholder,
    readOnly: readOnly || fixed,
    onChange: (event: { currentTarget: { value: string } }) => onChange(event.currentTarget.value),
  };
  return (
    <FieldShell
      label={label}
      path={path}
      labelId={`${id}-label`}
      controlId={id}
      hint={hint}
      locked={fixed && !readOnly}
    >
      {multiline ? (
        <Textarea {...common} rows={3} className={TEXTAREA_CLASS} />
      ) : (
        <Input {...common} className={QUIET_CONTROL_CLASS} />
      )}
    </FieldShell>
  );
}

/** A text that the document omits when it is empty. */
export function OptionalTextField({
  value,
  onChange,
  ...props
}: Omit<TextFieldProps, "value" | "onChange"> & {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}): ReactElement {
  return (
    <TextField
      {...props}
      value={value ?? ""}
      onChange={(next) => onChange(next.length === 0 ? undefined : next)}
    />
  );
}

/**
 * A text that must not be blank. The document takes only a valid text; the field keeps the typed
 * text and shows the reason until then.
 */
export function RequiredTextField({
  value,
  onChange,
  requiredMessage,
  ...props
}: TextFieldProps & { requiredMessage: string }): ReactElement {
  const { readOnly } = useInspector();
  const id = useId();
  // A blank text that the document did not take. A change of the value from outside drops it.
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  const shown = draft !== null && draft.base === value ? draft.text : value;
  const error = shown.trim().length === 0 ? requiredMessage : undefined;
  const common = {
    id,
    value: shown,
    placeholder: props.placeholder,
    readOnly,
    "aria-invalid": error ? true : undefined,
    onChange: (event: { currentTarget: { value: string } }) => {
      const next = event.currentTarget.value;
      if (next.trim().length === 0) {
        setDraft({ base: value, text: next });
        return;
      }
      setDraft(null);
      onChange(next);
    },
  };
  return (
    <FieldShell
      label={props.label}
      path={props.path}
      labelId={`${id}-label`}
      controlId={id}
      hint={props.hint}
      error={error}
    >
      {props.multiline ? (
        <Textarea {...common} rows={3} className={TEXTAREA_CLASS} />
      ) : (
        <Input {...common} className={QUIET_CONTROL_CLASS} />
      )}
    </FieldShell>
  );
}

/** The reason that an ID cannot apply, or undefined for a valid ID. */
const idProblem = (
  next: string,
  current: string,
  taken: ReadonlySet<string>,
): string | undefined => {
  if (next.trim().length === 0) return "Enter an ID. An ID cannot be blank.";
  if (next !== next.trim()) return "Remove the spaces at the start and the end of the ID.";
  if (next === "__proto__") return 'The ID "__proto__" is reserved. Use another ID.';
  if (next !== current && taken.has(next)) return `ID "${next}" is already used. Use another ID.`;
  return undefined;
};

type IdFieldProps = {
  label?: string;
  path: WorkflowProblemPath;
  value: string;
  /** The IDs of the same kind, the current one included. */
  taken: ReadonlySet<string>;
  onCommit: (next: string) => void;
  hint?: ReactNode;
  /** The ID cannot change, such as after the first publication. */
  fixed?: boolean;
  /** An extra rule of the ID, such as a required prefix. */
  validate?: (text: string) => string | undefined;
};

/**
 * An element ID. A valid ID applies on Enter or when the field loses focus, and renames every
 * reference. An invalid ID shows its reason and does not apply.
 */
export function IdField({
  label = "ID",
  path,
  value,
  taken,
  onCommit,
  hint,
  fixed = false,
  validate,
}: IdFieldProps): ReactElement {
  const { readOnly } = useInspector();
  const id = useId();
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  const text = draft !== null && draft.base === value ? draft.text : value;
  const error = idProblem(text, value, taken) ?? validate?.(text);
  const apply = () => {
    if (error !== undefined || text === value) return;
    setDraft(null);
    onCommit(text);
  };
  return (
    <FieldShell
      label={label}
      path={path}
      labelId={`${id}-label`}
      controlId={id}
      hint={hint}
      error={text === value ? undefined : error}
      locked={fixed && !readOnly}
    >
      <Input
        id={id}
        value={text}
        readOnly={readOnly || fixed}
        className={cn(QUIET_CONTROL_CLASS, "font-mono text-xs")}
        aria-invalid={error && text !== value ? true : undefined}
        onChange={(event) => setDraft({ base: value, text: event.currentTarget.value })}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === "Enter") apply();
          if (event.key === "Escape") setDraft(null);
        }}
      />
    </FieldShell>
  );
}

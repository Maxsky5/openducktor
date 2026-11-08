// The fields of a mobile workflow sheet, as form-rows.tsx, fields.tsx, and switch-card.tsx in
// apps/mobile/src/ui: a labeled field, an uppercase section label, the select trigger, the
// segmented control, the option cards of the approval, a bordered panel, a multiline text field,
// and a switch in a card. A scene changes `data-selected`, `data-on`, and `--segment-index`.
import { Check, ChevronsUpDown } from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { classes } from "../classes";
import { flag } from "../flag";
import "./FormRows.css";

/** A label above its control, with a value at the end of the label line and a hint under it. */
export function FormField({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value?: string;
  hint?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="mob-field">
      <span className="mob-field-label">
        <span>{label}</span>
        {value && <b>{value}</b>}
      </span>
      {children}
      {hint && <p className="mob-field-hint">{hint}</p>}
    </div>
  );
}

/** A small uppercase label above a group of choices. */
export function SectionLabel({ text }: { text: string }): ReactElement {
  return <span className="mob-section-label">{text}</span>;
}

/** The outlined select trigger with the chosen value and the up-down chevrons. */
export function SelectTrigger({
  value,
  detail,
  leading,
  mono = false,
}: {
  value: string;
  detail?: string;
  /** A mark before the value, such as the runtime brand mark or the branch icon. */
  leading?: ReactNode;
  mono?: boolean;
}): ReactElement {
  return (
    <span className="mob-select" data-mono={flag(mono)}>
      {leading}
      <span className="mob-select-text">
        <span className="mob-select-value">{value}</span>
        {detail && <span className="mob-select-detail">{detail}</span>}
      </span>
      <ChevronsUpDown className="mob-select-chevrons" />
    </span>
  );
}

/** The segmented control: a muted well with a thumb under the chosen segment. */
export function SegmentedControl({
  options,
  selected,
  hook,
}: {
  options: readonly { value: string; label: string }[];
  selected: string;
  /** The hook that a scene uses to find the control. */
  hook?: string;
}): ReactElement {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === selected),
  );
  const place: CSSProperties & { "--segment-index": number; "--segment-count": number } = {
    "--segment-index": index,
    "--segment-count": options.length,
  };
  return (
    <span className="mob-segments" style={place} data-segments={hook}>
      <i className="mob-segments-thumb" />
      {options.map((option) => (
        <span
          key={option.value}
          className="mob-segment"
          data-selected={flag(option.value === selected)}
          data-segment={option.value}
        >
          {option.label}
        </span>
      ))}
    </span>
  );
}

/** A choice card of the approval: the title, the description, and the check circle. */
export function OptionCard({
  value,
  title,
  description,
  selected,
}: {
  value: string;
  title: string;
  description: string;
  selected: boolean;
}): ReactElement {
  return (
    <span className="mob-option" data-selected={flag(selected)} data-option={value}>
      <span className="mob-option-text">
        <b>{title}</b>
        <span>{description}</span>
      </span>
      <span className="mob-option-check">
        <Check />
      </span>
    </span>
  );
}

/** A quiet bordered panel for a group of fields. `muted` takes the inset fill. */
export function FormPanel({
  muted = false,
  className,
  children,
}: {
  muted?: boolean;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={classes("mob-panel", className)} data-muted={flag(muted)}>
      {children}
    </div>
  );
}

/** A multiline TextField with its label. */
export function TextArea({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="mob-field">
      <span className="mob-textarea-label">{label}</span>
      <span className="mob-textarea">{value}</span>
    </div>
  );
}

/** The switch of fields.tsx: the input color when off, the switch color when on. */
export function Toggle({ on }: { on: boolean }): ReactElement {
  return (
    <span className="mob-toggle" data-on={flag(on)}>
      <i />
    </span>
  );
}

/** A switch row in an outlined card, with the details of the choice under it. */
export function SwitchCard({
  label,
  description,
  on,
  children,
}: {
  label: string;
  description?: string;
  on: boolean;
  children?: ReactNode;
}): ReactElement {
  return (
    <div className="mob-switch-card">
      <span className="mob-switch-row">
        <span className="mob-switch-text">
          <b>{label}</b>
          {description && <span>{description}</span>}
        </span>
        <Toggle on={on} />
      </span>
      {children && <div className="mob-switch-details">{children}</div>}
    </div>
  );
}

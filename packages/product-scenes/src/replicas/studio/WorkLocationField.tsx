// The Work location field of workspace-session-work-location-field.tsx: a radio group of outline
// cards, with the icon, the label, the check of the selected card, and the description. The Fork
// session dialog gives its two locations. A scene moves `data-selected`.
import { Check, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import "./WorkLocationField.css";

/** A card of the field: its value, label, description, and icon. */
export type WorkLocationOption<Value extends string> = {
  value: Value;
  label: string;
  description: string;
  Icon: LucideIcon;
};

type WorkLocationFieldProps<Value extends string> = {
  value: Value;
  options: readonly WorkLocationOption<Value>[];
};

export function WorkLocationField<Value extends string>({
  value,
  options,
}: WorkLocationFieldProps<Value>): ReactElement {
  return (
    <div className="wl">
      <b className="wl-legend">Work location</b>
      <div className="wl-options">
        {options.map(({ value: option, label, description, Icon }) => (
          <span
            className="wl-option"
            data-location={option}
            data-selected={flag(option === value)}
            key={option}
          >
            <Icon />
            <span className="wl-label">{label}</span>
            <Check className="wl-check" />
            <span className="wl-description">{description}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

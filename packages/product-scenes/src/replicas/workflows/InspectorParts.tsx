// The parts of the details panel of the workflow editor: InspectorHeader and the problem list of
// inspector/inspector-panel.tsx, PanelCard of panel-card.tsx, FieldShell of field-shell.tsx, and
// ProblemText of problem-text.tsx, in packages/frontend/src/features/workflows/editor. The state
// and the transition details build their fields from them.
import { AlertTriangle, ChevronsUpDown, type LucideIcon, Plus, Trash2, X } from "lucide-react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { IconTile, type KindColor } from "./IconTile";
import "./InspectorParts.css";

type InspectorHeaderProps = {
  Icon: LucideIcon;
  color: KindColor;
  kind: string;
  name: string;
  /** The help line under the name, such as the summary of a transition. */
  help?: ReactNode;
};

/** The kind, the name, and the help line of the selection, with Delete and Close. */
export function InspectorHeader({
  Icon,
  color,
  kind,
  name,
  help,
}: InspectorHeaderProps): ReactElement {
  return (
    <div className="wfe-ins-header">
      <div className="wfe-ins-title">
        <IconTile Icon={Icon} color={color} size="lg" />
        <div className="wfe-ins-names">
          <p className="wfe-ins-kind">{kind}</p>
          <p className="wfe-ins-name">{name}</p>
        </div>
        <span className="wfe-ins-icon">
          <Trash2 />
        </span>
        <span className="wfe-ins-icon">
          <X />
        </span>
      </div>
      {help === undefined ? null : <p className="wfe-ins-help">{help}</p>}
    </div>
  );
}

/**
 * A problem message as ProblemText shows it: each quoted label in typographic quotes and
 * font-medium.
 */
function ProblemText({ message }: { message: string }): ReactElement {
  return (
    <>
      {message.split(/"([^"]*)"/).map((part, index) =>
        index % 2 === 0 ? (
          part
        ) : (
          <span className="wfe-quoted" key={index}>
            “{part}”
          </span>
        ),
      )}
    </>
  );
}

/** The problems of the selection: a warning surface with one row for each warning. */
export function ElementProblems({
  message,
  ...attributes
}: ComponentProps<"ul"> & { message: string }): ReactElement {
  return (
    <ul className="wfe-ins-problems" data-element-problem="" {...attributes}>
      <li>
        <AlertTriangle />
        <span>
          <ProblemText message={message} />
        </span>
      </li>
    </ul>
  );
}

type PanelCardProps = {
  title?: string;
  description?: string;
  Icon?: LucideIcon;
  color?: KindColor;
  /** The control in the header, such as the switch of a card. */
  actions?: ReactNode;
  children?: ReactNode;
};

/** A group of fields as a card. A card without a title holds the main fields of the element. */
export function PanelCard({
  title,
  description,
  Icon,
  color = "slate",
  actions,
  children,
}: PanelCardProps): ReactElement {
  return (
    <div className="wfe-card">
      {title === undefined ? null : (
        <div className="wfe-card-head" data-bordered={children === undefined ? undefined : ""}>
          {Icon ? <IconTile Icon={Icon} color={color} size="sm" /> : null}
          <span className="wfe-card-heading">
            <b>{title}</b>
            {description === undefined ? null : <span>{description}</span>}
          </span>
          {actions}
        </div>
      )}
      {children === undefined ? null : <div className="wfe-card-body">{children}</div>}
    </div>
  );
}

/** FieldShell in its stack layout: the label over its control. */
export function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="wfe-field">
      <span className="wfe-field-label">{label}</span>
      {children}
    </div>
  );
}

/** A one-line text input with QUIET_CONTROL_CLASS. */
export function QuietInput({ value }: { value: string }): ReactElement {
  return <span className="wfe-quiet-input">{value}</span>;
}

/** The trigger of a SelectField with QUIET_CONTROL_CLASS: the value and a chevrons icon. */
export function QuietSelect({ children }: { children: ReactNode }): ReactElement {
  return (
    <span className="wfe-quiet-input wfe-quiet-select">
      <span className="wfe-select-value">{children}</span>
      <ChevronsUpDown />
    </span>
  );
}

/** LINK_BUTTON_CLASS of new-element-button.tsx: a plus and a brand-coloured text link. */
export function AddLink({
  label,
  ...attributes
}: ComponentProps<"span"> & { label: string }): ReactElement {
  return (
    <span className="wfe-add-link" {...attributes}>
      <Plus />
      {label}
    </span>
  );
}

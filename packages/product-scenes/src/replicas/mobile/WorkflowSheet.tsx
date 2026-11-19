// A full-height workflow sheet of the mobile app, as the phone shows a route sheet such as Start
// Session or Approve Task: sheet-screen.tsx draws the title, and the intro stays under it. The
// fields of form-rows.tsx scroll, and the footer of action-form.tsx holds the reason why the
// primary action is disabled, a third action, then Cancel at the width of its label and the
// primary action in the rest of the row. Cancel is the close control, so the header shows only the
// title. On Android, the app presents the sheet as a full-screen modal, and screens.ts fades it.
// While the primary action runs, a scene sets `data-busy` on the sheet: the app then disables the
// other controls of the form, and Cancel cannot close the sheet. While the sheet reads its data, a
// scene sets `data-preparing`: the loader of modal-loading-content.tsx takes the place of the form
// and its footer, so the header shows its own close control. A sheet that shows the startup
// progress in the place of its form has `data-progress`, and its close control is disabled while
// the start runs.
import { LoaderCircle, type LucideIcon, X } from "lucide-react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { classes } from "../classes";
import { flag } from "../flag";
import { MobileScreen } from "./MobileScreen";
import "./WorkflowSheet.css";

type WorkflowSheetProps = {
  /** The name that screens.ts uses to find the sheet. */
  id: string;
  title: string;
  /** The context under the title, such as the task title and ID. */
  intro: ReactNode;
  /** The fields of the form, as FormBody. */
  children: ReactNode;
  /** Why the primary action is disabled, or a hint about the step. */
  note?: string;
  /** The third action, such as Run in background. It shows above Cancel. */
  secondary?: ReactNode;
  /** The one primary action of the form. */
  primary: ReactNode;
  /** The label of the loader while the sheet reads its data, such as "Loading task details…". */
  loadingLabel?: string;
  /** The content that takes the place of the form and its footer, such as the startup progress. */
  progress?: ReactNode;
  hidden?: boolean | undefined;
  className?: string;
};

export function WorkflowSheet({
  id,
  title,
  intro,
  children,
  note,
  secondary,
  primary,
  loadingLabel,
  progress,
  hidden,
  className,
}: WorkflowSheetProps): ReactElement {
  return (
    <MobileScreen id={id} over hidden={hidden} className={classes("mob-fsheet", className)}>
      <header className="mob-fsheet-head">
        <strong data-sheet-title="">{title}</strong>
        <span className="mob-fsheet-close">
          <X />
        </span>
      </header>
      <div className="mob-fsheet-intro">{intro}</div>
      {loadingLabel && <SheetLoader label={loadingLabel} />}
      {progress && <div className="mob-fsheet-progress">{progress}</div>}
      <div className="mob-fsheet-scroll">
        <div className="mob-fsheet-body" data-sheet-body="">
          {children}
        </div>
      </div>
      <footer className="mob-fsheet-foot">
        {note && <p className="mob-fsheet-note">{note}</p>}
        {secondary && <div className="mob-fsheet-row">{secondary}</div>}
        <div className="mob-fsheet-row">
          <SheetButton variant="outline" label="Cancel" />
          {primary}
        </div>
      </footer>
    </MobileScreen>
  );
}

/**
 * The loader of modal-loading-content.tsx: the spinner in a muted circle with its label, and two
 * placeholder lines of 80 and 60 percent.
 */
function SheetLoader({ label }: { label: string }): ReactElement {
  return (
    <div className="mob-fsheet-loading">
      <span className="mob-fsheet-loading-row">
        <span className="mob-fsheet-spinner">
          <LoaderCircle className="spin" />
        </span>
        {label}
      </span>
      <span className="mob-fsheet-lines">
        <i />
        <i />
      </span>
    </div>
  );
}

type SheetButtonProps = ComponentProps<"span"> & {
  label: ReactNode;
  /** The label while the action runs, such as "Pushing main…". */
  busyLabel?: ReactNode;
  variant: "filled" | "outline" | "warning";
  Icon?: LucideIcon;
};

/**
 * A large Button of button.tsx in a form footer: violet `filled`, `outline`, or the amber
 * `warning`. A long label wraps to more lines. While `data-loading` is on the button, a spinner
 * takes the place of the icon, `busyLabel` takes the place of the label, and the button keeps its
 * full color.
 */
export function SheetButton({
  label,
  busyLabel,
  variant,
  Icon,
  className,
  ...attributes
}: SheetButtonProps): ReactElement {
  return (
    <span className={classes("mob-fbutton", className)} data-variant={variant} {...attributes}>
      {Icon && <Icon className="mob-fbutton-icon" />}
      {Icon && <LoaderCircle className="mob-fbutton-spinner spin" />}
      <span className="mob-fbutton-label" data-idle-label={flag(busyLabel !== undefined)}>
        {label}
      </span>
      {busyLabel !== undefined && (
        <span className="mob-fbutton-label" data-busy-label="">
          {busyLabel}
        </span>
      )}
    </span>
  );
}

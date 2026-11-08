// A full-height workflow sheet of the mobile app, as the phone shows a route sheet such as Start
// Session or Approve Task: sheet-screen.tsx draws the title, and the intro stays under it. The
// fields of form-rows.tsx scroll, and the footer of action-form.tsx holds the reason why the
// primary action is disabled, a third action, then Cancel at the width of its label and the
// primary action in the rest of the row. Cancel is the close control, so the header shows only the
// title. On Android, the app presents the sheet as a full-screen modal, and screens.ts fades it.
import { LoaderCircle, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { classes } from "../classes";
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
  hidden,
  className,
}: WorkflowSheetProps): ReactElement {
  return (
    <MobileScreen id={id} over hidden={hidden} className={classes("mob-fsheet", className)}>
      <header className="mob-fsheet-head">
        <strong data-sheet-title="">{title}</strong>
      </header>
      <div className="mob-fsheet-intro">{intro}</div>
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

type SheetButtonProps = ComponentProps<"span"> & {
  label: ReactNode;
  variant: "filled" | "outline" | "warning";
  Icon?: LucideIcon;
};

/**
 * A large Button of button.tsx in a form footer: violet `filled`, `outline`, or the amber
 * `warning`. A long label wraps to more lines. While `data-loading` is on the button, a spinner
 * takes the place of the icon.
 */
export function SheetButton({
  label,
  variant,
  Icon,
  className,
  ...attributes
}: SheetButtonProps): ReactElement {
  return (
    <span className={classes("mob-fbutton", className)} data-variant={variant} {...attributes}>
      {Icon && <Icon className="mob-fbutton-icon" />}
      {Icon && <LoaderCircle className="mob-fbutton-spinner spin" />}
      <span className="mob-fbutton-label">{label}</span>
    </span>
  );
}

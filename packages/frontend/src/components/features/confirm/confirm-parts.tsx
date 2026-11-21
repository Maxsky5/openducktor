import { AlertTriangle, Check, Info, type LucideIcon, Minus } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The header of a confirmation: the icon of the action in a tile, the title, one line that says
 * what the action does, and the subject that it changes, such as a task or a workflow.
 */
export function ConfirmHeader({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** The subject line under the title, such as the name and the ID. */
  children?: ReactNode;
}): ReactElement {
  return (
    <DialogHeader className="gap-4 px-6 pb-5 pt-6 pr-14">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="leading-5">{description}</DialogDescription>
        </div>
      </div>
      {children}
    </DialogHeader>
  );
}

function ImpactList({
  title,
  items,
  Icon,
}: {
  title: string;
  items: readonly string[];
  Icon: LucideIcon;
}): ReactElement {
  return (
    <section className="flex flex-col gap-2.5" aria-label={title}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm leading-5">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What a confirmed action changes and what it keeps, with its warning. A warning that the user
 * can undo the action, such as with ⌘Z, shows as a note.
 */
export function ConfirmImpact({
  changes,
  kept = [],
  warning,
  undoable = false,
  children,
}: {
  changes: readonly string[];
  kept?: readonly string[] | undefined;
  warning: string;
  undoable?: boolean | undefined;
  /** More content after the warning, such as the errors of a check. */
  children?: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-5">
      {changes.length > 0 ? <ImpactList title="What changes" items={changes} Icon={Minus} /> : null}
      {kept.length > 0 ? <ImpactList title="What stays" items={kept} Icon={Check} /> : null}
      {undoable ? (
        <Alert role="note">
          <Info aria-hidden="true" />
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning" role="note">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}
      {children}
    </div>
  );
}

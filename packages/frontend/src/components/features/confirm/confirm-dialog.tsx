import { AlertTriangle, Loader2, type LucideIcon, X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { ConfirmHeader, ConfirmImpact } from "./confirm-parts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import { focusDialogContent } from "@/lib/focus-dialog-content";

/** What a confirmed command changes and keeps, with its warning. */
export type ConfirmImpactCopy = {
  readonly changes: readonly string[];
  readonly kept?: readonly string[] | undefined;
  readonly warning: string;
  /** The user can undo the command, such as with ⌘Z, so the warning shows as a note. */
  readonly undoable?: boolean;
};

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The action, such as "Delete workflow". */
  title: string;
  /** One line that says what the action does. */
  description: string;
  icon: LucideIcon;
  /** The element that the command changes, such as a `ConfirmSubject`. */
  subject?: ReactNode;
  /** Null while something else fills the body, such as what blocks the command. */
  impact: ConfirmImpactCopy | null;
  /** Null leaves only Close, such as while something blocks the command. */
  confirmLabel: string | null;
  variant: "default" | "destructive" | "warning";
  pending: boolean;
  /** The host message of a failed command. The dialog stays open with it. */
  error: string | null;
  onConfirm: () => void;
  /** The command cannot run yet, such as while a check reads. */
  confirmDisabled?: boolean;
  /** Cancel. By default it closes the dialog. */
  onCancel?: () => void;
  /** The dialog waits for the reads that its copy needs. */
  loading?: boolean;
  loadingLabel?: string;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
  children?: ReactNode;
};

/** The name and the ID of the element that a command changes, as the task dialogs show a task. */
export function ConfirmSubject({ name, id }: { name: string; id: string }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="line-clamp-2 min-w-0 max-w-full text-sm font-medium break-words text-foreground [overflow-wrap:anywhere]">
        {name}
      </span>
      <code className="shrink-0 font-mono text-xs text-muted-foreground">{id}</code>
    </div>
  );
}

/**
 * A confirmation of one host command: the action and its subject, what changes and what stays,
 * and the warning. The caller keeps its pending state and its error.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  icon: Icon,
  subject,
  impact,
  confirmLabel,
  variant,
  pending,
  error,
  onConfirm,
  confirmDisabled = false,
  onCancel = () => onOpenChange(false),
  loading = false,
  loadingLabel,
  onCloseAutoFocus,
  children,
}: ConfirmDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      {/* The dialog takes the focus, so no button shows a ring. */}
      <DialogContent
        className="max-w-lg overflow-hidden p-0"
        loading={loading}
        loadingLabel={loadingLabel}
        onOpenAutoFocus={focusDialogContent}
        onCloseAutoFocus={onCloseAutoFocus}
        closeButton={
          // The close button lines up with the icon tile and the title of the header.
          <DialogClose className="absolute top-6 right-4 z-20 flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        }
      >
        <ConfirmHeader icon={Icon} title={title} description={description}>
          {subject}
        </ConfirmHeader>
        <DialogBody className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-6">
          {children}
          {impact ? (
            <ConfirmImpact
              changes={impact.changes}
              kept={impact.kept}
              warning={impact.warning}
              undoable={impact.undoable}
            />
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        {/* Close or Cancel always sits on the left, as in the other dialogs. */}
        <DialogFooter className="mt-0 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            {confirmLabel === null ? "Close" : "Cancel"}
          </Button>
          {confirmLabel === null ? null : (
            <Button
              type="button"
              variant={variant}
              disabled={pending || confirmDisabled}
              aria-busy={pending}
              onClick={onConfirm}
            >
              {pending ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Icon data-icon="inline-start" />
              )}
              {confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

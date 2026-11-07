import { AlertTriangle, Loader2, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import type {
  TaskConfirmControlState,
  TaskConfirmCopy,
} from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { TaskDialogHeader } from "./task-dialog-header";
import { TaskConfirmContent } from "./task-confirm-content";
import { focusDialogContent } from "@/lib/focus-dialog-content";

/** One layout for task reset, implementation reset, and deletion. */
export function TaskConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  copy,
  confirm,
  pending,
  error,
  icon: Icon,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  copy: TaskConfirmCopy;
  confirm: TaskConfirmControlState;
  pending: boolean;
  error: string | null;
  icon: LucideIcon;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
}): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg overflow-hidden p-0"
        loading={confirm.isBusy && !pending}
        loadingLabel="Loading task details…"
        onOpenAutoFocus={focusDialogContent}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <TaskDialogHeader
          title={copy.title}
          description={copy.description}
          subject={copy.subject}
          icon={Icon}
        />
        <DialogBody className="min-h-0 overflow-y-auto px-6 pb-6">
          <TaskConfirmContent copy={copy} />
          {error ? (
            <Alert variant="destructive" className="mt-4">
              <AlertTriangle aria-hidden="true" />
              <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter className="mt-0 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={copy.tone}
            disabled={confirm.disabled}
            aria-busy={pending}
            onClick={onConfirm}
          >
            {pending ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Icon data-icon="inline-start" />
            )}
            {confirm.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

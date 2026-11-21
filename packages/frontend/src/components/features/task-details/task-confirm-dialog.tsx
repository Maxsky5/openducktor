import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import type {
  TaskConfirmControlState,
  TaskConfirmCopy,
} from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import { ConfirmDialog } from "@/components/features/confirm/confirm-dialog";
import { TaskConfirmContent } from "./task-confirm-content";
import { TaskIdentity } from "./task-identity";

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
  icon,
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
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      description={copy.description}
      icon={icon}
      subject={<TaskIdentity title={copy.subject.title ?? ""} taskId={copy.subject.id} />}
      impact={null}
      confirmLabel={confirm.label}
      variant={copy.tone}
      pending={pending}
      error={error}
      onConfirm={onConfirm}
      confirmDisabled={confirm.disabled}
      onCancel={onCancel}
      loading={confirm.isBusy && !pending}
      loadingLabel="Loading task details…"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <TaskConfirmContent copy={copy} />
    </ConfirmDialog>
  );
}

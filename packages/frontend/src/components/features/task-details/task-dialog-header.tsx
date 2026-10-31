import type { LucideIcon } from "lucide-react";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TaskConfirmSubject } from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import { TaskIdentity } from "./task-identity";

export function TaskDialogHeader({
  title,
  description,
  subject,
  icon: Icon,
}: {
  title: string;
  description: string;
  subject: TaskConfirmSubject;
  icon: LucideIcon;
}) {
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
      <TaskIdentity title={subject.title ?? ""} taskId={subject.id} />
    </DialogHeader>
  );
}

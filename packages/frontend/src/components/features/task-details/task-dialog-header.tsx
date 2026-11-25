import type { LucideIcon } from "lucide-react";
import type { TaskConfirmSubject } from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import { ConfirmHeader } from "@/components/features/confirm/confirm-parts";
import { TaskIdentity } from "./task-identity";

export function TaskDialogHeader({
  title,
  description,
  subject,
  icon,
}: {
  title: string;
  description: string;
  subject: TaskConfirmSubject;
  icon: LucideIcon;
}) {
  return (
    <ConfirmHeader icon={icon} title={title} description={description}>
      <TaskIdentity title={subject.title ?? ""} taskId={subject.id} />
    </ConfirmHeader>
  );
}

import type { TaskArtifactContent } from "@openducktor/frontend-core/queries/artifacts";
import type { ReactElement } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TaskArtifactPreview } from "./task-artifact-preview";

export function TaskArtifactPreviewDialog({
  content,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  content: TaskArtifactContent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[calc(100dvh-4rem)] max-w-5xl overflow-hidden p-0"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="border-b border-border px-4 py-3 pr-12">
          <DialogTitle className="truncate text-sm font-medium">
            {content.artifact.name}
          </DialogTitle>
          <DialogDescription className="sr-only">Expanded artifact preview.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <TaskArtifactPreview artifact={content.artifact} bytes={content.bytes} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

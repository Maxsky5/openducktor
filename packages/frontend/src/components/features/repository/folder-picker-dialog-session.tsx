import type { ReactElement } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FolderPickerCancelAction, FolderPickerConfirmAction } from "./folder-picker-actions";
import { FolderPickerContent } from "./folder-picker-content";
import {
  type FolderPickerCommonProps,
  useFolderPickerController,
} from "./use-folder-picker-controller";

export function FolderPickerDialogSession({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  initialPath,
  requireGitRepo = false,
  selectionMode = "directory",
  onConfirm,
}: FolderPickerCommonProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const controller = useFolderPickerController({
    open,
    onOpenChange,
    initialPath,
    requireGitRepo,
    selectionMode,
    onConfirm,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!controller.canDismiss && !nextOpen) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-w-4xl px-5 pb-8 pt-6 sm:px-6"
        {...(controller.canDismiss ? {} : { closeButton: null })}
        onEscapeKeyDown={(event) => {
          if (!controller.canDismiss) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (!controller.canDismiss) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="px-1">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 px-1 pt-4">
          <FolderPickerContent controller={controller} />
        </DialogBody>

        <DialogFooter className="mt-4 block border-t-0 px-1 pt-0">
          <div className="flex flex-col-reverse justify-between gap-3 border-t border-border pt-4 sm:flex-row">
            <FolderPickerCancelAction controller={controller} />
            <FolderPickerConfirmAction controller={controller} confirmLabel={confirmLabel} />
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

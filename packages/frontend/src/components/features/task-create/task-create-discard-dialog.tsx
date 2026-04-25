import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TaskCreateDiscardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onKeepEditing: () => void;
  onDiscardChanges: () => void;
};

export function TaskCreateDiscardDialog({
  open,
  onOpenChange,
  onKeepEditing,
  onDiscardChanges,
}: TaskCreateDiscardDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Discard unsaved markdown changes?</DialogTitle>
        </DialogHeader>

        <DialogBody className="pt-2">
          <DialogDescription>
            You have unsaved document edits. Discard them before leaving this section?
          </DialogDescription>
        </DialogBody>

        <DialogFooter className="mt-0 flex-row justify-end gap-2 border-t border-border pt-5">
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={onKeepEditing}
          >
            Keep editing
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="cursor-pointer"
            onClick={onDiscardChanges}
          >
            Discard changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

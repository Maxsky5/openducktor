import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReactElement } from "react";

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
          <DialogDescription>
            You have unsaved document edits. Discard them before leaving this section?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6 flex-row justify-end gap-2">
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

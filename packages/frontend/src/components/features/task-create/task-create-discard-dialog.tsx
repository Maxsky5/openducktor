import { Trash2 } from "lucide-react";
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
          <DialogTitle>Discard unsaved changes?</DialogTitle>
        </DialogHeader>

        <DialogBody className="pt-2">
          <DialogDescription>Your changes to this document have not been saved.</DialogDescription>
        </DialogBody>

        <DialogFooter className="mt-0 flex-row gap-2 border-t border-border pt-5">
          <Button type="button" variant="outline" onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={onDiscardChanges}>
            <Trash2 data-icon="inline-start" />
            Discard changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

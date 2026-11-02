import { Loader2, Square } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { terminalTabLabel } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/use-terminals";

export type TerminalCloseDialogModel = {
  /** The terminal that still runs a process and waits for confirmation. */
  candidate: TerminalTab | null;
  isConfirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function TerminalCloseDialog({ model }: { model: TerminalCloseDialogModel }): ReactElement {
  const { candidate, isConfirming } = model;
  return (
    <Dialog
      open={candidate !== null}
      onOpenChange={(open) => !open && !isConfirming && model.onCancel()}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Stop and close {candidate ? terminalTabLabel(candidate) : "terminal"}?
          </DialogTitle>
          <DialogDescription>
            Stops the terminal and the processes it started. Unfinished work may be lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="justify-between border-t border-border pt-5">
          <Button type="button" variant="outline" onClick={model.onCancel} disabled={isConfirming}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={model.onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Square data-icon="inline-start" />
            )}
            Stop and close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

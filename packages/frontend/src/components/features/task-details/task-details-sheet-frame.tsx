import {
  TaskWorkflowDialogOwnerContext,
  useTaskWorkflowActions,
} from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useRef,
} from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";

type ClaimDialog = (run: () => void) => void;

const TaskDetailsSheetClaimDialogContext = createContext<ClaimDialog | null>(null);

/** Runs a sheet action. The shared workflow dialog that it opens keeps the sheet open. */
export function useTaskDetailsSheetClaimDialog(): ClaimDialog {
  const claimDialog = useContext(TaskDetailsSheetClaimDialogContext);
  if (claimDialog === null)
    throw new Error("The task details sheet content requires TaskDetailsSheetFrame");
  return claimDialog;
}

/**
 * The task details sheet. Callers swap the loading, empty, and task content inside one frame,
 * so the sheet slides once and keeps its exit animation when content arrives.
 */
export function TaskDetailsSheetFrame({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}): ReactElement {
  const contentRef = useRef<HTMLDivElement>(null);
  const dialogOwner = useId();
  const ownsWorkflowDialog = useContext(TaskWorkflowDialogOwnerContext) === dialogOwner;
  const claimWorkflowDialog = useTaskWorkflowActions()?.claimWorkflowDialog;
  const claimDialog = useCallback<ClaimDialog>(
    (run) => {
      if (claimWorkflowDialog) claimWorkflowDialog(dialogOwner, run);
      else run();
    },
    [claimWorkflowDialog, dialogOwner],
  );
  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={contentRef}
        side="right"
        closeButton={null}
        visualOverlay
        className="h-full max-h-screen gap-0 p-0 sm:max-w-[680px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
        // Workflow dialogs mount outside the sheet. Focus in a dialog that the sheet does not own
        // closes the sheet. Focus that a closing dialog returns to the page behind the sheet does
        // not; a click outside still closes it.
        onFocusOutside={(event) => {
          if (ownsWorkflowDialog || !isInDialog(event.target)) event.preventDefault();
        }}
      >
        <TaskDetailsSheetClaimDialogContext.Provider value={claimDialog}>
          {children}
        </TaskDetailsSheetClaimDialogContext.Provider>
      </SheetContent>
    </Sheet>
  );
}

const isInDialog = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]') !== null;

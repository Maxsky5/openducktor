import type { PropsWithChildren, ReactElement } from "react";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import {
  startupShowsProgress,
  startupTraceRows,
} from "@openducktor/frontend-core/sessions/startup/startup-trace";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function ChatDialogFrame({
  open,
  attempt,
  starting,
  onClose,
  onCloseAutoFocus,
  title,
  description,
  children,
}: PropsWithChildren<{
  title: string;
  description: string;
  open: boolean;
  attempt: StartupAttempt | null;
  starting: boolean;
  onClose: () => void;
  onCloseAutoFocus: ((event: Event) => void) | undefined;
}>): ReactElement {
  const showingProgress = startupShowsProgress(attempt);
  const hasTrace = attempt !== null && startupTraceRows(attempt).length > 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !starting) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "my-0 gap-0 p-0 sm:max-w-2xl",
          showingProgress && "max-w-lg overflow-hidden sm:max-w-lg",
          hasTrace && "min-h-[min(18rem,calc(100dvh-2rem))] max-h-[min(30rem,calc(100dvh-2rem))]",
        )}
        closeButton={starting ? null : undefined}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (starting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (starting) event.preventDefault();
        }}
      >
        <DialogHeader
          className={cn("border-b border-border px-6 py-4", showingProgress && "px-4 py-3")}
        >
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={cn(showingProgress && "sr-only")}>
            {description}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

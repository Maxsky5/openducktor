import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useCallback } from "react";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { observeDialogResize } from "./dialog-resize";
import { DialogRoot, useDialogOpen } from "./dialog-root";

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogRoot {...props} data-slot="dialog" />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-[70] bg-black/45 backdrop-blur-sm", className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  closeButton,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  closeButton?: React.ReactNode;
}) {
  const isOpen = useDialogOpen("DialogContent", "Dialog");
  const setContentRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      const stopObserving = observeDialogResize(element);
      if (ref && "current" in ref) {
        ref.current = element;
        return () => {
          stopObserving();
          ref.current = null;
        };
      }
      if (ref) {
        const releaseRef = ref(element);
        return () => {
          stopObserving();
          if (releaseRef) releaseRef();
          else ref(null);
        };
      }
      return stopObserving;
    },
    [ref],
  );
  const renderedCloseButton =
    closeButton === undefined ? (
      <DialogPrimitive.Close className="absolute right-4 top-4 z-20 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        <X className="size-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    ) : (
      closeButton
    );

  return (
    <DialogPortal>
      <DialogOverlay />
      <div
        data-slot="dialog-positioner"
        data-state={isOpen ? "open" : "closed"}
        className="fixed inset-0 z-[70] grid items-start justify-items-center overflow-y-auto p-4 sm:items-center"
      >
        <DialogPrimitive.Content
          data-slot="dialog-content"
          ref={setContentRef}
          className={cn(
            "t-modal t-resize pointer-events-auto relative z-[70] flex w-full min-h-0 max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-y-auto rounded-xl border border-border bg-popover p-6 shadow-xl",
            className,
          )}
          {...props}
          aria-hidden={!isOpen}
          inert={!isOpen}
        >
          {children}
          {renderedCloseButton}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex-1", className)} {...props} />;
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("sticky top-0 z-10 flex shrink-0 flex-col gap-1.5 bg-popover", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 mt-6 flex shrink-0 justify-end gap-2 bg-popover",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className="text-lg font-semibold" {...props} />;
}

function DialogDescription(props: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className="text-sm text-muted-foreground" {...props} />;
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};

export { useDialogPresence } from "./dialog-presence";

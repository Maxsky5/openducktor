import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useCallback, useContext, useMemo } from "react";
import type * as React from "react";
import { useMinimumLoader } from "@openducktor/frontend-core/lib/use-minimum-loader";
import { cn } from "@/lib/utils";
import type { DialogMotion } from "./dialog-presence";
import { observeDialogResize } from "./dialog-resize";
import { DialogRoot, useDialogOpen } from "./dialog-root";
import { DialogLoadingContent } from "./dialog-loading";
import { DialogLoadingContext } from "./dialog-loading-context";

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
  overlayClassName,
  positionerClassName,
  motion = "animated",
  children,
  closeButton,
  loading,
  loadingLabel = "Loading…",
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
  /** Classes of the full-screen grid that places the dialog. */
  positionerClassName?: string;
  /** Use the same value in `useDialogPresence`. "instant" also resizes the dialog at once. */
  motion?: DialogMotion;
  closeButton?: React.ReactNode;
  /** Loads the body and its actions for at least 500 ms while the header stays visible. */
  loading?: boolean | undefined;
  loadingLabel?: string | undefined;
}) {
  const isOpen = useDialogOpen("DialogContent", "Dialog");
  const isLoading = useMinimumLoader(loading === true, isOpen);
  const loadingState = useMemo(
    () => (loading === undefined ? null : { loading: isLoading, label: loadingLabel }),
    [loading, isLoading, loadingLabel],
  );
  const setContentRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      const stopObserving = motion === "animated" ? observeDialogResize(element) : () => {};
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
    [motion, ref],
  );
  const renderedCloseButton =
    closeButton === undefined ? (
      <DialogPrimitive.Close className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <X className="size-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    ) : (
      closeButton
    );

  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} data-motion={motion} />
      <div
        data-slot="dialog-positioner"
        data-state={isOpen ? "open" : "closed"}
        data-motion={motion}
        className={cn(
          "fixed inset-0 z-[70] grid items-start justify-items-center overflow-y-auto p-4 sm:items-center",
          positionerClassName,
        )}
      >
        <DialogPrimitive.Content
          data-slot="dialog-content"
          data-motion={motion}
          ref={setContentRef}
          className={cn(
            "t-modal pointer-events-auto relative z-[70] flex w-full min-h-0 max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-y-auto rounded-xl border border-border bg-popover p-6 shadow-xl",
            motion === "animated" && "t-resize",
            className,
          )}
          {...props}
          aria-hidden={!isOpen}
          inert={!isOpen}
          aria-busy={isLoading || undefined}
        >
          <DialogLoadingContext value={loadingState}>{children}</DialogLoadingContext>
          {renderedCloseButton}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  );
}

function DialogBody({ className, children, ...props }: React.ComponentProps<"div">) {
  const state = useContext(DialogLoadingContext);
  const loading = state?.loading === true;
  return (
    <div
      data-slot="dialog-body"
      className={cn("min-w-0 flex-1", className, loading && "px-6")}
      {...props}
      aria-busy={loading || undefined}
    >
      {state ? (
        <DialogLoadingContent loading={loading} label={state.label}>
          {children}
        </DialogLoadingContent>
      ) : (
        children
      )}
    </div>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("sticky top-0 z-10 flex shrink-0 flex-col gap-1.5 bg-popover pr-8", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, style, ...props }: React.ComponentProps<"div">) {
  const loading = useContext(DialogLoadingContext)?.loading === true;
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "sticky bottom-0 z-10 mt-6 flex shrink-0 flex-col-reverse justify-end gap-2 bg-popover [&_button]:min-h-11 sm:flex-row sm:[&_button]:min-h-9",
        className,
      )}
      {...props}
      inert={loading}
      aria-hidden={loading || undefined}
      style={{ ...style, display: loading ? "none" : style?.display }}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg font-semibold leading-6", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm leading-6 text-muted-foreground", className)}
      {...props}
    />
  );
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

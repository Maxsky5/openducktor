import { type ReactElement, type ReactNode, useRef } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";

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
      >
        {children}
      </SheetContent>
    </Sheet>
  );
}

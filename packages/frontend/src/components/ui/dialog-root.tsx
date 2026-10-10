import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createContext, useContext, useEffect, useState } from "react";
import type * as React from "react";

const DialogOpenContext = createContext<boolean | null>(null);

/** Every open `Dialog` and `Sheet` root, so a global shortcut can leave an open dialog alone. */
const openDialogRoots = new Set<symbol>();

export const hasOpenDialog = (): boolean => openDialogRoots.size > 0;

/** Shares the Radix Dialog open state with plain elements that need `data-state`. */
export function DialogRoot({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const [registration] = useState(() => Symbol("dialog-root"));
  const isOpen = open ?? internalOpen;
  useEffect(() => {
    if (!isOpen) return;
    openDialogRoots.add(registration);
    return () => {
      openDialogRoots.delete(registration);
    };
  }, [isOpen, registration]);
  return (
    <DialogOpenContext.Provider value={isOpen}>
      <DialogPrimitive.Root
        {...props}
        open={isOpen}
        onOpenChange={(nextOpen) => {
          if (open === undefined) setInternalOpen(nextOpen);
          onOpenChange?.(nextOpen);
        }}
      />
    </DialogOpenContext.Provider>
  );
}

export function useDialogOpen(component: string, root: string): boolean {
  const isOpen = useContext(DialogOpenContext);
  if (isOpen === null) throw new Error(`${component} must be used within ${root}.`);
  return isOpen;
}

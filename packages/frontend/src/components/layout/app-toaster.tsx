import type { CSSProperties, ReactElement } from "react";
import { useBackgroundAttempts } from "@openducktor/frontend-core/operations/use-background-attempts";
import { useStartupAttempts } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { Toaster } from "@/components/ui/sonner";
import { useToasterBottomInset } from "@/components/ui/toaster-inset";

const EDGE_OFFSET = 16;

// Layers: sheets 50, dialogs 70, toasts 75, the update card and tooltips 80, menus 90. A menu that
// the user opens stays above toasts.
const toasterStyle: CSSProperties = { zIndex: 75 };

const startupToasterStyle = (bottomOffset: number): CSSProperties => {
  // The stack fills the screen between the top and bottom offsets.
  const height = `calc(100dvh - ${EDGE_OFFSET + bottomOffset}px)`;
  return {
    ...toasterStyle,
    // Bottom toasts grow upward. A reversed scroll origin keeps older cards reachable.
    display: "flex",
    flexDirection: "column-reverse",
    height,
    maxHeight: height,
    overflowY: "auto",
    pointerEvents: "none",
  };
};

/**
 * Shows every app notification above the page, sheets, and dialogs, and below open menus. Toasts
 * stay above the bottom elements that reserve space, such as an open sheet footer.
 */
export function AppToaster(): ReactElement {
  const attempts = useStartupAttempts();
  const operations = useBackgroundAttempts();
  const progressVisible =
    attempts.some((attempt) => attempt.presentation === "notification") ||
    operations.some((attempt) => !attempt.toastDismissed);
  const bottomOffset = EDGE_OFFSET + useToasterBottomInset();
  const offset = {
    top: EDGE_OFFSET,
    right: EDGE_OFFSET,
    bottom: bottomOffset,
    left: EDGE_OFFSET,
  };
  return (
    <Toaster
      offset={offset}
      mobileOffset={offset}
      visibleToasts={progressVisible ? Infinity : 5}
      style={progressVisible ? startupToasterStyle(bottomOffset) : toasterStyle}
      className="overscroll-contain [&>[data-sonner-toast]]:pointer-events-auto"
    />
  );
}

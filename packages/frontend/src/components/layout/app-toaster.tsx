import type { CSSProperties, ReactElement } from "react";
import { useStartupAttempts } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { Toaster } from "@/components/ui/sonner";

const startupToasterStyle: CSSProperties = {
  // Bottom toasts grow upward. A reversed scroll origin keeps older cards reachable.
  display: "flex",
  flexDirection: "column-reverse",
  height: "calc(100dvh - 2rem)",
  maxHeight: "calc(100dvh - 2rem)",
  overflowY: "auto",
  pointerEvents: "none",
};

/** Shows every app notification above the page, sheets, and dialogs. */
export function AppToaster(): ReactElement {
  const attempts = useStartupAttempts();
  const startupVisible = attempts.some((attempt) => attempt.presentation === "notification");
  return (
    <Toaster
      offset={16}
      mobileOffset={16}
      visibleToasts={startupVisible ? Infinity : 5}
      style={startupVisible ? startupToasterStyle : {}}
      className="overscroll-contain [&>[data-sonner-toast]]:pointer-events-auto"
    />
  );
}

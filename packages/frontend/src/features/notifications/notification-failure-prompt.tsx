import { type ReactElement, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { NotificationDispatchFailure } from "./notification-policy";

export function NotificationFailurePrompt({
  failure,
  onOpenSettings,
}: {
  failure: NotificationDispatchFailure | null;
  onOpenSettings(): void;
}): ReactElement | null {
  const reportedOccurrenceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!failure) {
      reportedOccurrenceIdRef.current = null;
      return;
    }
    if (reportedOccurrenceIdRef.current === failure.occurrenceId) return;
    reportedOccurrenceIdRef.current = failure.occurrenceId;
    toast.error("OS notification failed", {
      id: "notification-os-delivery-failure",
      description: failure.message,
      action: { label: "Open settings", onClick: onOpenSettings },
    });
  }, [failure, onOpenSettings]);

  return null;
}

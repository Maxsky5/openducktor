import { type ReactElement, useEffect } from "react";
import { toast } from "sonner";
import type { NotificationDispatchFailure } from "./notification-policy";

export function NotificationFailurePrompt({
  failure,
  onOpenSettings,
  onReload,
}: {
  failure: NotificationDispatchFailure | null;
  onOpenSettings(): void;
  onReload(): void;
}): ReactElement | null {
  useEffect(() => {
    if (!failure) return;
    let title = "OS notification failed";
    const id = `notification-failure:${failure.channel}:${failure.occurrenceId}`;
    let action = { label: "Open settings", onClick: onOpenSettings };
    if (failure.channel === "coordination") {
      title = "Browser notification coordination failed";
      action = { label: "Reload", onClick: onReload };
    }
    if (failure.channel === "settings") {
      title = "Notification settings could not be loaded";
      action = { label: "Reload", onClick: onReload };
    }
    if (failure.channel === "sound") title = "Notification sound failed";
    toast.error(title, {
      id,
      description: failure.message,
      action,
    });
    return () => {
      toast.dismiss(id);
    };
  }, [failure, onOpenSettings, onReload]);

  return null;
}

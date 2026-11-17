import { toast } from "sonner";

export const reportStaleNotificationTarget = (message: string): void => {
  toast.error("Notification target is no longer available", { description: message });
};

import { LoaderCircle } from "lucide-react";
import { createElement } from "react";
import { toast } from "sonner";
import type { LifecycleNotificationPort } from "./app-lifecycle-coordinator";

export const lifecycleNotifications: LifecycleNotificationPort = {
  error: (title, description) => toast.error(title, { description }),
  loading: (title, description) =>
    toast(title, {
      description,
      icon: createElement(LoaderCircle, {
        className: "size-4 animate-spin",
        "aria-hidden": "true",
      }),
      duration: Infinity,
      closeButton: true,
      dismissible: true,
    }),
  success: (title, description) => toast.success(title, { description }),
  dismiss: (id) => toast.dismiss(id),
};

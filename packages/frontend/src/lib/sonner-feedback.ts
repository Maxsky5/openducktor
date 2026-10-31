import type { ClientFeedback } from "@openducktor/frontend-core/platform/client-feedback";
import { toast } from "sonner";

export const notificationClassNames = {
  toast: "!flex-col !items-stretch",
  content: "w-full",
  actionButton: "!m-0 !h-9 !w-full !rounded-md justify-center",
};

/** Shows client feedback with the app toasts. */
export const sonnerFeedback: ClientFeedback = {
  show: (kind, message, options) => {
    toast[kind](message, options);
  },
  dismiss: (id) => {
    toast.dismiss(id);
  },
};

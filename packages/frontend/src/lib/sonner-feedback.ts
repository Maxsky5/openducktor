import type { ClientFeedback } from "@openducktor/frontend-core/platform/client-feedback";
import { toast } from "sonner";

/** Shows client feedback with the app toasts. */
export const sonnerFeedback: ClientFeedback = {
  show: (kind, message, options) => {
    toast[kind](message, options);
  },
  dismiss: (id) => {
    toast.dismiss(id);
  },
};

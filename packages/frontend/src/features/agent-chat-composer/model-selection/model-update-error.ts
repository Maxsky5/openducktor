import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";

export const reportModelUpdateError = (error: unknown): void => {
  toast.error("Failed to update model", {
    description: errorMessage(error),
  });
};

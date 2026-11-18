import { useCallback } from "react";
import { useFeedbackStore } from "@/app-shell/app-services";

/** The title of every demo notice. */
export const DEMO_NOTICE_TITLE = "Not available in the demo";

/** The reason of a web link in the demo. Demo links name fictional pages. */
export const DEMO_LINK_NOTICE = "This link is part of the demo sample data and opens no web page.";

/**
 * Shows that a control needs a real host. The notice names the reason and the next action, and
 * changes nothing.
 */
export const useDemoNotice = (): ((message: string) => void) => {
  const { feedback } = useFeedbackStore();
  return useCallback(
    (message: string) => {
      feedback.show("info", DEMO_NOTICE_TITLE, { description: message });
    },
    [feedback],
  );
};

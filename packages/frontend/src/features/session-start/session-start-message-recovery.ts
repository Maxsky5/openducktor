import { toast } from "sonner";
import {
  type SessionStartMessageRetry,
  sessionStartMessageRetry,
} from "@openducktor/frontend-core/sessions/start/session-start-message-retry";
import type { SessionStartWorkflowResult } from "@openducktor/frontend-core/sessions/start/session-start-workflow";

const showRetryToast = (recovery: SessionStartMessageRetry): void => {
  if (recovery.kind === "unknown") {
    toast.warning(recovery.title, { description: recovery.description, duration: Infinity });
    return;
  }
  toast.error(recovery.title, {
    description: recovery.description,
    duration: Infinity,
    classNames: {
      toast: "!flex-col !items-stretch",
      content: "w-full",
      actionButton: "!m-0 !h-9 !w-full !rounded-md justify-center",
    },
    action: {
      label: recovery.actionLabel,
      onClick: () => {
        void recovery.retry().then((next) => {
          if (next) showRetryToast(next);
        });
      },
    },
  });
};

export const showSessionStartMessageRecovery = (result: SessionStartWorkflowResult): void => {
  const recovery = sessionStartMessageRetry(result);
  if (recovery) showRetryToast(recovery);
};

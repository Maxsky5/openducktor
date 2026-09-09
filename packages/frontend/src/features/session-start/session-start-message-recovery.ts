import { toast } from "sonner";
import type { SessionStartWorkflowResult } from "./session-start-workflow";

export const showSessionStartMessageRecovery = (result: SessionStartWorkflowResult): void => {
  const retry = result.retryPostStartMessage;
  if (!retry || !result.postStartActionError) return;
  toast.error("Session started, but the first message failed.", {
    description: result.postStartActionError.message,
    duration: Infinity,
    action: {
      label: "Retry message",
      onClick: () => {
        void retry().catch((cause) =>
          showSessionStartMessageRecovery({
            ...result,
            postStartActionError: cause instanceof Error ? cause : new Error(String(cause)),
          }),
        );
      },
    },
  });
};
